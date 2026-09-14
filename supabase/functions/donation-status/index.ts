/**
 * Confirms one Stripe Checkout Session, for the page a guest lands back on
 * after paying.
 *
 * The redirect back from Stripe carries a session id in the URL, and that id
 * is the only thing this reads - it is unguessable (Stripe generates it) and
 * good for one completed payment, so there is nothing else to check it
 * against. Reading Stripe directly here, rather than trusting the amount the
 * browser remembers from before the redirect, is what makes the thank-you
 * screen honest: the guest's own tab left this site entirely to pay, and
 * anything it "remembers" about what happened on Stripe's page is a guess.
 *
 * Set the key with:
 *
 *   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_your_real_key
 *
 * (the same secret create-donation-checkout uses) and deploy with:
 *
 *   npx supabase functions deploy donation-status --project-ref mkcuiglmsmxcchywruay
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type Payload = { sessionId?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) {
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

  const sessionId = (payload.sessionId ?? "").trim();
  // Stripe's own session ids: cs_ then live/test then base62. Rejecting
  // anything else means a malformed id is a 400 here rather than a request
  // sent on to Stripe with nothing gained by asking it.
  if (!/^cs_[a-zA-Z0-9_]{10,255}$/.test(sessionId)) {
    return json({ error: "That doesn't look like a checkout session." }, 400);
  }

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: result?.error?.message ?? `Stripe refused it (${res.status}).` }, 502);
  }

  if (result.payment_status !== "paid") {
    return json({ ok: false, error: "That payment did not go through." });
  }

  return json({
    ok: true,
    amountCents: result.amount_total ?? 0,
    name: result.metadata?.name || result.customer_details?.name || "",
    email: result.customer_details?.email || result.customer_email || "",
  });
});
