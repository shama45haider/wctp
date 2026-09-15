/**
 * Starts a real Stripe payment for a gift to WECAMETOOPARTY.
 *
 * Same reasoning as send-email: the site is a static export with no server,
 * so a secret key anywhere a page imports it would sit in the bundle every
 * visitor downloads. Stripe's secret key lives here instead, as a secret on
 * this Deno function, and the browser only ever asks it to start a checkout
 * and gets back a URL on Stripe's own domain to send the guest to. No card
 * number ever reaches this site - Stripe's own hosted page takes it.
 *
 * Set the key with:
 *
 *   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_your_real_key
 *
 * and deploy with:
 *
 *   npx supabase functions deploy create-donation-checkout --use-api --project-ref mkcuiglmsmxcchywruay
 *
 * Anyone can give, signed in or not. A signed-in donor's user id is attached
 * to the Stripe session so donation-status can put them on the donor board.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_ENDPOINT = "https://api.stripe.com/v1/checkout/sessions";

/**
 * Where a guest lands after paying or backing out. Taken from the caller
 * rather than fixed, so this still works from a local dev build - but only
 * ever one of these two, so nothing can point a real payment's redirect at a
 * domain that isn't ours.
 */
const ALLOWED_ORIGINS = new Set([
  "https://wecametooparty.com",
  "http://localhost:3000",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js sends apikey and x-client-info on every invoke; a preflight
  // that doesn't allow them makes the browser drop the call entirely.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** $1 to $5,000 - wide enough for a real gift, narrow enough that a typo can't wire five figures. */
const MIN_CENTS = 100;
const MAX_CENTS = 500_000;

type Payload = {
  amountCents?: number;
  name?: string;
  email?: string;
  origin?: string;
  /** Only means anything for a signed-in donor. */
  showOnBoard?: boolean;
};

/**
 * The signed-in donor, or null. supabase-js sends the donor's own session
 * token when there is one and the public key when there isn't; the public key
 * names nobody, so only a real session comes back as a user.
 */
async function donorId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anonKey || token === anonKey) return null;
  try {
    const { data } = await createClient(url, anonKey).auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) {
    // Said plainly rather than as a 500 to go hunting for: the usual reason
    // is that the secret was never set.
    return json(
      { error: "STRIPE_SECRET_KEY is not set on this function. See supabase secrets set." },
      500,
    );
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const amountCents = Math.round(Number(payload.amountCents));
  const name = (payload.name ?? "").trim().slice(0, 200);
  const email = (payload.email ?? "").trim().slice(0, 320);
  const origin = ALLOWED_ORIGINS.has(payload.origin ?? "")
    ? (payload.origin as string)
    : "https://wecametooparty.com";

  if (!Number.isFinite(amountCents) || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
    return json({ error: "Give between $1 and $5,000." }, 400);
  }
  if (!name) return json({ error: "Put in a name." }, 400);
  if (!EMAIL.test(email)) return json({ error: "That email doesn't look right." }, 400);

  const userId = await donorId(req);

  // The same request the Stripe SDK's checkout.sessions.create() makes,
  // called directly so this function carries no Stripe dependency to resolve
  // and pin inside Deno every cold start.
  const body = new URLSearchParams({
    mode: "payment",
    submit_type: "donate",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": "Donation to WECAMETOOPARTY",
    success_url: `${origin}/donate/?success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/donate/?canceled=1`,
    customer_email: email,
    "metadata[name]": name,
  });
  if (userId) {
    body.set("metadata[user_id]", userId);
    body.set("metadata[show_on_board]", payload.showOnBoard === false ? "false" : "true");
  }

  const res = await fetch(STRIPE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Stripe's own wording, passed through rather than flattened: a bad key
    // and a malformed amount need different fixes, and only Stripe knows
    // which one happened.
    return json({ error: result?.error?.message ?? `Stripe refused it (${res.status}).` }, 502);
  }

  return json({ url: result.url });
});
