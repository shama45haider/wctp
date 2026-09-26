/**
 * The buyer landing back from Stripe after paying for a prize: confirms the
 * session with Stripe, records the order if the webhook hasn't yet, and hands
 * back the claim code for the QR.
 *
 * Only to the person who bought it. The session id rides in the redirect URL,
 * so it is checked against the signed-in caller - a screenshot of someone's
 * address bar is not their prize.
 *
 *   npx supabase functions deploy store-order-status --use-api --project-ref mkcuiglmsmxcchywruay
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { recordStoreOrder } from "../_shared/store.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return json({ error: "Payments are not configured." }, 500);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await asCaller.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Sign in to see your prize." }, 401);

  let payload: { sessionId?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!/^cs_[a-zA-Z0-9_]{10,255}$/.test(sessionId)) {
    return json({ error: "That doesn't look like a checkout session." }, 400);
  }

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const session = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: session?.error?.message ?? `Stripe refused it (${res.status}).` }, 502);
  }
  if (session.metadata?.user_id !== user.id) {
    return json({ error: "That purchase belongs to another account." }, 403);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const out = await recordStoreOrder(admin, session, key);
  if (!out.ok) return json({ ok: false, error: out.error });

  const o = out.order;
  return json({
    ok: true,
    order: {
      id: o.id,
      productName: o.product_name,
      qty: o.qty,
      amountCents: o.amount_cents,
      claimCode: o.claim_code,
      invoiceUrl: o.invoice_url,
      paidAt: o.paid_at,
      redeemedAt: o.redeemed_at,
    },
  });
});
