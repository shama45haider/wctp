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
import { ensureTierPrice, eventTitleFor, isMissing0030, type TierRow } from "../_shared/stripe-catalog.ts";

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
type AddonPick = { addonId?: unknown; qty?: unknown };
type Payload = { eventSlug?: unknown; lines?: unknown; addons?: unknown; origin?: unknown };

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

  const BASE = "event_slug, tier_id, name, price_cents, max_per_order, admits, donation, capacity, sold";
  const readTiers = (cols: string) =>
    admin.from("ticket_tiers").select(cols).eq("event_slug", eventSlug) as unknown as Promise<{
      // deno-lint-ignore no-explicit-any
      data: Record<string, any>[] | null;
      error: { message: string } | null;
    }>;
  let { data: tiers, error: tierErr } = await readTiers(
    `${BASE}, stripe_product_id, stripe_price_id, stripe_price_cents`,
  );
  // Before 0030 there are no Stripe ids to read. Sell anyway, described inline.
  if (tierErr && isMissing0030(tierErr.message)) {
    ({ data: tiers, error: tierErr } = await readTiers(BASE));
  }

  if (tierErr) return json({ error: "Could not read prices." }, 500);
  if (!tiers || tiers.length === 0) return json({ error: "Nothing on sale." }, 400);

  const byId = new Map(tiers.map((t) => [t.tier_id as string, t]));

  const priced: {
    name: string;
    unit: number;
    qty: number;
    tierId: string;
    admits: number;
    row: TierRow;
  }[] = [];
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
      row: tier as unknown as TierRow,
    });
  }

  // One ticket per verified account, per date: one in this order, and none
  // already held. Add-ons aren't tickets and don't count. Any order that isn't
  // cancelled is a ticket - paid ones are only written once Stripe has the
  // money, and browsers may only write free ones.
  const ticketsWanted = priced.reduce((n, l) => n + l.qty, 0);
  if (ticketsWanted > 1) return json({ error: "One ticket per account." }, 400);
  const { count: held, error: heldErr } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("event_slug", eventSlug)
    .is("cancelled_at", null);
  if (heldErr) return json({ error: "Could not check your tickets." }, 500);
  if (held) {
    return json({ error: "You already have a ticket for this date - it's on your account." }, 409);
  }

  // Add-ons, priced from public.ticket_addons. Only ever alongside a ticket,
  // which the loop above has already required.
  const picks = Array.isArray(payload.addons) ? (payload.addons as AddonPick[]) : [];
  const extras: { id: string; name: string; unit: number; qty: number }[] = [];
  if (picks.length > 0) {
    const { data: addonRows, error: addonErr } = await admin
      .from("ticket_addons")
      .select("id, name, price_cents, max_per_order, active");
    if (addonErr) return json({ error: "Could not read add-on prices." }, 500);
    const addonsById = new Map((addonRows ?? []).map((a) => [a.id as string, a]));
    for (const pick of picks) {
      const addonId = typeof pick.addonId === "string" ? pick.addonId : "";
      const qty = Number(pick.qty);
      if (!addonId || !Number.isInteger(qty) || qty <= 0) {
        return json({ error: "Bad add-on." }, 400);
      }
      const a = addonsById.get(addonId);
      if (!a || !a.active) return json({ error: "That add-on is not available." }, 400);
      if (qty > (a.max_per_order as number)) {
        return json({ error: `Only ${a.max_per_order} ${a.name} per order.` }, 400);
      }
      const unit = a.price_cents as number;
      subtotal += unit * qty;
      extras.push({ id: addonId, name: a.name as string, unit, qty });
    }
  }

  if (subtotal <= 0) {
    // A cart of nothing but free tickets never reaches Stripe - the site books
    // those directly, and sending a $0 session would just fail.
    return json({ error: "Nothing to pay for." }, 400);
  }

  // Must match totalsFor() in lib/tickets.ts: a percentage of tickets and
  // add-ons, plus a flat amount per paid ticket.
  const fee = Math.round(subtotal * SERVICE_RATE) + SERVICE_FLAT_CENTS * paidTickets;
  const total = subtotal + fee;
  if (total > MAX_TOTAL_CENTS) return json({ error: "That order is too large." }, 400);

  // The date's name, for the invoice and the order: the dashboard's copy if an
  // admin has saved the date's address, a posted date's own row, or the slug.
  // Built-in dates' slugs are their titles in lowercase, so even the last
  // resort reads right.
  const title = await eventTitleFor(admin, eventSlug);

  // Each paid ticket is charged through its Stripe Price, made now if the
  // admin's save didn't reach Stripe. ensureTierPrice prices from the row
  // above, so this changes where the sale shows up in Stripe, never the
  // amount. If Stripe won't make one, the line is described inline instead -
  // a missing product is no reason to turn a buyer away.
  const priceIds = await Promise.all(
    priced.map((l) =>
      "stripe_price_id" in l.row
        ? ensureTierPrice(admin, key, l.row, title, false)
            .then((ids) => ids?.priceId ?? null)
            .catch(() => null)
        : Promise.resolve(null),
    ),
  );

  // ------------------------------------------------------------- Stripe --

  const form = new URLSearchParams();
  form.set("mode", "payment");
  // Stripe fills in the session id, which /account hands to
  // ticket-order-status so the tickets appear without waiting on the webhook.
  form.set("success_url", `${origin}/account?paid=tickets&session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${origin}/checkout`);
  if (profile.email) form.set("customer_email", String(profile.email));

  priced.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty));
    const priceId = priceIds[i];
    if (priceId) {
      form.set(`line_items[${i}][price]`, priceId);
      return;
    }
    form.set(`line_items[${i}][price_data][currency]`, "usd");
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.unit));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
  });
  extras.forEach((a, j) => {
    const i = priced.length + j;
    form.set(`line_items[${i}][quantity]`, String(a.qty));
    form.set(`line_items[${i}][price_data][currency]`, "usd");
    form.set(`line_items[${i}][price_data][unit_amount]`, String(a.unit));
    form.set(`line_items[${i}][price_data][product_data][name]`, a.name);
  });
  // The fee as its own line, so the buyer sees what the site added rather than
  // finding the ticket costs more than the page said.
  const feeAt = priced.length + extras.length;
  form.set(`line_items[${feeAt}][quantity]`, "1");
  form.set(`line_items[${feeAt}][price_data][currency]`, "usd");
  form.set(`line_items[${feeAt}][price_data][unit_amount]`, String(fee));
  form.set(`line_items[${feeAt}][price_data][product_data][name]`, "Service fee");

  // Everything the webhook needs to build the order, carried by Stripe so the
  // two sides cannot disagree about what was bought.
  form.set("metadata[kind]", "tickets");
  form.set("metadata[user_id]", user.id);
  form.set("metadata[event_slug]", eventSlug);
  form.set("metadata[lines]", JSON.stringify(
    priced.map((l) => ({ t: l.tierId, n: l.name, u: l.unit, q: l.qty, a: l.admits })),
  ));
  form.set("metadata[addons]", JSON.stringify(
    extras.map((a) => ({ i: a.id, n: a.name, u: a.unit, q: a.qty })),
  ));
  form.set("metadata[event_title]", title);
  form.set("metadata[fee_cents]", String(fee));
  form.set("metadata[subtotal_cents]", String(subtotal));

  // A real Stripe invoice for the payment, emailed to the buyer - the same as
  // the store's prizes get.
  form.set("invoice_creation[enabled]", "true");
  form.set("invoice_creation[invoice_data][description]", `WECAMETOOPARTY tickets - ${title}`);
  form.set(
    "invoice_creation[invoice_data][footer]",
    "Your ticket QR is on your account at wecametooparty.com/account. The address is emailed to you the day before.",
  );
  form.set("invoice_creation[invoice_data][metadata][kind]", "tickets");
  form.set("invoice_creation[invoice_data][metadata][event_slug]", eventSlug);

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
