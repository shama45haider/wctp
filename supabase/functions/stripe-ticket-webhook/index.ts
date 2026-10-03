/**
 * Turns a completed Stripe payment into an order, its lines and its passes.
 *
 * This is the only thing on the site that may create a paid order - the policy
 * in 0023 lets a browser insert free ones and nothing else. It runs on the
 * service role key, which bypasses row-level security, so everything it does
 * has to be right here rather than being caught downstream.
 *
 * Three things matter and each is load-bearing:
 *
 *   1. The signature is checked before the body is believed. This endpoint is
 *      public and unauthenticated - without verification, anybody who knows the
 *      URL can post a made-up "payment succeeded" and get free tickets.
 *   2. Nothing is read from the event except metadata this site wrote and the
 *      amount Stripe itself charged.
 *   3. Delivery happens more than once. Stripe retries, and a retry must not
 *      issue a second set of passes - the unique index on stripe_session_id is
 *      what makes the second attempt a no-op instead of a duplicate.
 *
 * Deploy without the JWT gate, since Stripe cannot send one:
 *
 *   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
 *   npx supabase functions deploy stripe-ticket-webhook --no-verify-jwt --use-api --project-ref mkcuiglmsmxcchywruay
 *
 * Then add the endpoint in Stripe, subscribed to checkout.session.completed.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { recordStoreOrder } from "../_shared/store.ts";
import { recordTicketOrder } from "../_shared/tickets.ts";

const enc = new TextEncoder();

/**
 * Stripe's signature scheme, by hand.
 *
 * The header is `t=<unix>,v1=<hex hmac>`, and the signed payload is
 * `<t>.<raw body>` under the endpoint secret. Compared in constant time,
 * because a timing-variable compare on a signature is a way to learn it a byte
 * at a time.
 */
async function signatureIsGood(
  raw: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  // Five minutes. An old-but-valid body replayed forever is still a forgery.
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`));
  const mine = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (mine.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 500 });

  const signature = req.headers.get("stripe-signature") ?? "";
  // Read once, as text. Parsing first and re-serialising would change the
  // bytes and the signature would never match.
  const raw = await req.text();

  if (!(await signatureIsGood(raw, signature, secret))) {
    return new Response("bad signature", { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Anything else is acknowledged and ignored, so Stripe stops retrying it.
  if (event.type !== "checkout.session.completed") {
    return new Response("ignored", { status: 200 });
  }

  const session = event.data?.object ?? {};
  const sessionId = String(session.id ?? "");
  const paid = session.payment_status === "paid";
  if (!sessionId || !paid) return new Response("not paid", { status: 200 });

  const meta = (session.metadata ?? {}) as Record<string, string>;

  // A prize from the store rather than tickets: recorded by the shared code
  // store-order-status also uses, so whichever arrives first wins and the
  // other finds it done.
  if (meta.kind === "store") {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const out = await recordStoreOrder(admin, session, Deno.env.get("STRIPE_SECRET_KEY"));
    return out.ok
      ? new Response("ok", { status: 200 })
      : new Response(`store order failed: ${out.error}`, { status: 500 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const out = await recordTicketOrder(admin, session, Deno.env.get("STRIPE_SECRET_KEY"));
  if (!out.ok) {
    // A database failure asks Stripe to retry; anything else (not ours, not
    // paid, bad metadata) is acknowledged so it stops.
    return new Response(out.error, { status: out.retry ? 500 : 200 });
  }
  return new Response("ok", { status: 200 });
});
