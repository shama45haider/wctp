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

/** WCTP-XXXXXX, the shape the rest of the site expects an order id to be. */
function orderId() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `WCTP-${out}`;
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
  const userId = meta.user_id;
  const eventSlug = meta.event_slug;
  if (!userId || !eventSlug) return new Response("no metadata", { status: 200 });

  let lines: { t: string; n: string; u: number; q: number; a: number }[];
  try {
    lines = JSON.parse(meta.lines ?? "[]");
  } catch {
    return new Response("bad metadata", { status: 200 });
  }
  if (lines.length === 0) return new Response("no lines", { status: 200 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Already handled? Stripe delivers more than once by design.
  const { data: seen } = await admin
    .from("orders")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (seen) return new Response("already done", { status: 200 });

  // What Stripe actually took, not what the site expected it to.
  const total = Number(session.amount_total ?? 0);
  const subtotal = Number(meta.subtotal_cents ?? 0);
  const fee = Number(meta.fee_cents ?? 0);

  const { data: profile } = await admin
    .from("profiles")
    .select("name, email, phone")
    .eq("id", userId)
    .maybeSingle();

  const { data: eventRow } = await admin
    .from("events")
    .select("title")
    .eq("slug", eventSlug)
    .maybeSingle();

  const id = orderId();

  const { error: orderErr } = await admin.from("orders").insert({
    id,
    user_id: userId,
    event_slug: eventSlug,
    event_title: eventRow?.title ?? eventSlug,
    subtotal_cents: subtotal,
    discount_cents: 0,
    fee_cents: fee,
    total_cents: total,
    buyer_name: profile?.name ?? "",
    buyer_email: profile?.email ?? String(session.customer_email ?? ""),
    buyer_phone: profile?.phone ?? null,
    paid_at: new Date().toISOString(),
    stripe_session_id: sessionId,
  });

  if (orderErr) {
    // A unique violation here is the race that the check above cannot close -
    // two deliveries in flight at once. Both are the same payment, so the
    // loser acknowledges rather than asking Stripe to try again.
    if (/duplicate key|unique/i.test(orderErr.message)) {
      return new Response("already done", { status: 200 });
    }
    // Anything else: fail loudly so Stripe retries rather than a paid order
    // quietly never existing.
    return new Response(`order failed: ${orderErr.message}`, { status: 500 });
  }

  const { error: lineErr } = await admin.from("order_lines").insert(
    lines.map((l) => ({
      order_id: id,
      tier_id: l.t,
      tier_name: l.n,
      qty: l.q,
      unit_cents: l.u,
      admits: l.a,
      donation: false,
    })),
  );
  if (lineErr) return new Response(`lines failed: ${lineErr.message}`, { status: 500 });

  const passes: Record<string, unknown>[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.q; i++) {
      passes.push({
        code: `${id}-${l.t.toUpperCase()}-${i + 1}`,
        order_id: id,
        tier_id: l.t,
        tier_name: l.n,
        admits: l.a,
        price_cents: l.u,
      });
    }
  }
  const { error: passErr } = await admin.from("passes").insert(passes);
  if (passErr) return new Response(`passes failed: ${passErr.message}`, { status: 500 });

  return new Response("ok", { status: 200 });
});
