/**
 * Starts a real Stripe payment for tickets.
 *
 * The important thing this does is price the order itself. The browser sends
 * an event slug and a list of tier ids with quantities, and nothing else it
 * says about money is read - the amounts come out of public.ticket_tiers,
 * which no client can write. A request asking for a $250 table at $1 gets
 * charged $250, because the $1 was never looked at.
 *
 * No order row is created here either. An order appears only when the webhook
 * hears from Stripe that the money arrived; a checkout someone opens and
 * abandons leaves nothing behind to clean up or mistake for a sale.
 *
 * Set the key and deploy:
 *
 *   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_your_real_key
 *   npx supabase functions deploy create-ticket-checkout --use-api --project-ref mkcuiglmsmxcchywruay
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_ENDPOINT = "https://api.stripe.com/v1/checkout/sessions";

/**
 * Where Stripe sends the buyer afterwards. Taken from the caller so a local
 * build works, but only ever one of these - nothing can point a real payment's
 * redirect at a domain that is not ours.
 */
const ALLOWED_ORIGINS = new Set([
  "https://wecametooparty.com",
  "http://localhost:3000",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Matches SERVICE_RATE and SERVICE_FLAT_CENTS in lib/tickets.ts. */
const SERVICE_RATE = 0.055;
const SERVICE_FLAT_CENTS = 119;

/** A whole order cannot exceed this. A typo should not be able to bill four figures. */
const MAX_TOTAL_CENTS = 300_000;

type Line = { tierId?: unknown; qty?: unknown };
type Payload = { eventSlug?: unknown; lines?: unknown; origin?: unknown };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return json({ error: "Payments are not configured." }, 500);

  // Who is asking. The caller's JWT, not a user id from the body - a body can
  // say it is anybody.
  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  // Buying needs the same age check the door does. The policy on chat_messages
  // enforces its own gate; orders are created by the webhook on the service
  // role key, so this is the only place that check can happen for a purchase.
  const { data: profile } = await supabase
    .from("profiles")
    .select("verified, email, name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.verified) {
    return json({ error: "Your age has to be checked before you can buy." }, 403);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const eventSlug = typeof payload.eventSlug === "string" ? payload.eventSlug.trim() : "";
  if (!eventSlug) return json({ error: "Which event?" }, 400);

  const wanted = Array.isArray(payload.lines) ? (payload.lines as Line[]) : [];
  if (wanted.length === 0) return json({ error: "Nothing selected." }, 400);

  const origin = typeof payload.origin === "string" ? payload.origin : "";
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Bad origin." }, 400);

  // ------------------------------------------------------------- pricing --

  // Read with the service role: ticket_tiers is world-readable, but taking it
  // on this client keeps the price lookup independent of whatever the caller's
  // session can or cannot see.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: tiers, error: tierErr } = await admin
    .from("ticket_tiers")
    .select("tier_id, name, price_cents, max_per_order, admits, donation, capacity, sold")
    .eq("event_slug", eventSlug);

  if (tierErr) return json({ error: "Could not read prices." }, 500);
  if (!tiers || tiers.length === 0) return json({ error: "Nothing on sale." }, 400);

  const byId = new Map(tiers.map((t) => [t.tier_id as string, t]));

  const priced: { name: string; unit: number; qty: number; tierId: string; admits: number }[] = [];
  let subtotal = 0;
  let paidTickets = 0;

  for (const line of wanted) {
    const tierId = typeof line.tierId === "string" ? line.tierId : "";
    const qty = Number(line.qty);
    if (!tierId || !Number.isInteger(qty) || qty <= 0) {
      return json({ error: "Bad line." }, 400);
    }

    const tier = byId.get(tierId);
    if (!tier) return json({ error: "That ticket is not on sale." }, 400);
    // Donations have their own flow and an amount the giver names; letting one
    // through here would mean an amount the buyer chose, which is the one thing
    // this function exists to prevent.
    if (tier.donation) return json({ error: "Not buyable here." }, 400);

    if (qty > (tier.max_per_order as number)) {
      return json({ error: `Only ${tier.max_per_order} of ${tier.name} per order.` }, 400);
    }
    const left = (tier.capacity as number) - (tier.sold as number);
    if (qty > left) return json({ error: `Only ${Math.max(left, 0)} left.` }, 400);

    const unit = tier.price_cents as number;
    subtotal += unit * qty;
    if (unit > 0) paidTickets += qty;
    priced.push({
      name: tier.name as string,
      unit,
      qty,
      tierId,
      admits: (tier.admits as number) ?? 1,
    });
  }

  if (subtotal <= 0) {
    // A cart of nothing but free tickets never reaches Stripe - the site books
    // those directly, and sending a $0 session would just fail.
    return json({ error: "Nothing to pay for." }, 400);
  }

  const fee = Math.round(subtotal * SERVICE_RATE) + SERVICE_FLAT_CENTS * paidTickets;
  const total = subtotal + fee;
  if (total > MAX_TOTAL_CENTS) return json({ error: "That order is too large." }, 400);

  // ------------------------------------------------------------- Stripe --

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${origin}/account?paid=1`);
  form.set("cancel_url", `${origin}/checkout`);
  if (profile.email) form.set("customer_email", String(profile.email));

  priced.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty));
    form.set(`line_items[${i}][price_data][currency]`, "usd");
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.unit));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
  });
  // The fee as its own line, so the buyer sees what the site added rather than
  // finding the ticket costs more than the page said.
  form.set(`line_items[${priced.length}][quantity]`, "1");
  form.set(`line_items[${priced.length}][price_data][currency]`, "usd");
  form.set(`line_items[${priced.length}][price_data][unit_amount]`, String(fee));
  form.set(`line_items[${priced.length}][price_data][product_data][name]`, "Service fee");

  // Everything the webhook needs to build the order, carried by Stripe so the
  // two sides cannot disagree about what was bought.
  form.set("metadata[user_id]", user.id);
  form.set("metadata[event_slug]", eventSlug);
  form.set("metadata[lines]", JSON.stringify(
    priced.map((l) => ({ t: l.tierId, n: l.name, u: l.unit, q: l.qty, a: l.admits })),
  ));
  form.set("metadata[fee_cents]", String(fee));
  form.set("metadata[subtotal_cents]", String(subtotal));

  const res = await fetch(STRIPE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const session = await res.json();
  if (!res.ok || !session?.url) {
    return json({ error: session?.error?.message ?? "Stripe refused that." }, 502);
  }

  return json({ url: session.url });
});
