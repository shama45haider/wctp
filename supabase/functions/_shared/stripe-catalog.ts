/**
 * Keeps a Stripe Product and Price behind every paid ticket tier.
 *
 * Shared by sync-ticket-products (an admin saving a tier) and
 * create-ticket-checkout (a buyer paying, which heals any tier the admin save
 * didn't reach - made before this existed, or saved while Stripe was down).
 *
 * The amount always comes from public.ticket_tiers. Stripe is told what the
 * row says; nothing read back from Stripe decides a price.
 *
 * Runs on the service role key.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

const API = "https://api.stripe.com/v1";

export type TierRow = {
  event_slug: string;
  tier_id: string;
  name: string;
  price_cents: number;
  donation: boolean | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
};

export const TIER_COLUMNS =
  "event_slug, tier_id, name, price_cents, donation, stripe_product_id, stripe_price_id, stripe_price_cents";

/** PostgREST's answer when 0030 has not been run yet. */
export const isMissing0030 = (m: string) =>
  /stripe_(product|price)_/i.test(m) && /does not exist|could not find|schema cache/i.test(m);

async function stripe(
  key: string,
  path: string,
  form?: URLSearchParams,
  /**
   * Stripe returns the first answer again for a repeated key, so two checkouts
   * racing to create the same tier's product get one product between them.
   */
  idempotencyKey?: string,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${API}${path}`, { method: form ? "POST" : "GET", headers, body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe answered ${res.status}.`);
  return body;
}

/** Short, stable, and different whenever `s` is. For idempotency keys. */
async function digest(s: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const productName = (eventTitle: string, tierName: string) =>
  `${eventTitle} - ${tierName}`.slice(0, 250);

/**
 * Makes sure the tier has a live Product and a Price for exactly its current
 * amount, and returns the two ids. Null for a free or donation tier, which
 * never goes to Stripe as a product.
 *
 * `rename` also pushes the product's name, for when the admin has just edited
 * it. A checkout passes false: it only needs the price to be right.
 */
export async function ensureTierPrice(
  admin: Admin,
  key: string,
  tier: TierRow,
  eventTitle: string,
  rename: boolean,
): Promise<{ productId: string; priceId: string } | null> {
  if (tier.donation || tier.price_cents <= 0) return null;

  const fresh = tier.stripe_price_id && tier.stripe_price_cents === tier.price_cents;
  if (fresh && !rename && tier.stripe_product_id) {
    return { productId: tier.stripe_product_id, priceId: tier.stripe_price_id as string };
  }

  const name = productName(eventTitle, tier.name);
  const meta = (form: URLSearchParams) => {
    form.set("metadata[kind]", "ticket");
    form.set("metadata[event_slug]", tier.event_slug);
    form.set("metadata[tier_id]", tier.tier_id);
  };

  let productId = tier.stripe_product_id;
  if (productId) {
    const form = new URLSearchParams({ name, active: "true" });
    meta(form);
    try {
      await stripe(key, `/products/${encodeURIComponent(productId)}`, form);
    } catch {
      // Deleted from the Stripe dashboard, or made under a different Stripe
      // account (test keys swapped for live ones). Start a new one.
      productId = null;
    }
  }
  if (!productId) {
    const form = new URLSearchParams({ name });
    meta(form);
    // The lost product's id is in the key so a replacement isn't answered
    // with the product it replaces.
    const ik = `wctp-product-${tier.event_slug}-${tier.tier_id}-${tier.stripe_product_id ?? "new"}-${await digest(name)}`;
    productId = (await stripe(key, "/products", form, ik)).id as string;
  }

  let priceId = productId === tier.stripe_product_id && fresh ? tier.stripe_price_id : null;
  if (!priceId) {
    const form = new URLSearchParams({
      product: productId,
      currency: "usd",
      unit_amount: String(tier.price_cents),
    });
    meta(form);
    // Keyed on the price being replaced too: $20 -> $25 -> $20 needs a third
    // price, not the first one back, which is archived by then.
    const ik = `wctp-price-${productId}-${tier.price_cents}-${tier.stripe_price_id ?? "new"}`;
    priceId = (await stripe(key, "/prices", form, ik)).id as string;

    // The new price becomes the product's default, then the old one is
    // archived - in that order, because Stripe won't archive a default price.
    await stripe(key, `/products/${encodeURIComponent(productId)}`, new URLSearchParams({ default_price: priceId }));
    if (tier.stripe_price_id && tier.stripe_price_id !== priceId) {
      await stripe(
        key,
        `/prices/${encodeURIComponent(tier.stripe_price_id)}`,
        new URLSearchParams({ active: "false" }),
      ).catch(() => {});
    }
  }

  await admin
    .from("ticket_tiers")
    .update({
      stripe_product_id: productId,
      stripe_price_id: priceId,
      stripe_price_cents: tier.price_cents,
    })
    .eq("event_slug", tier.event_slug)
    .eq("tier_id", tier.tier_id);

  return { productId, priceId };
}

/**
 * Archives the Stripe products of an event's tiers that are gone or now free,
 * found by the metadata ensureTierPrice gives them. Archived, never deleted:
 * Stripe keeps a product that has sales, and the dashboard's history with it.
 *
 * Best effort. Stripe's search lags writes by up to a minute, so a product
 * made seconds ago may not be found until the next sync.
 */
export async function archiveStaleProducts(
  key: string,
  eventSlug: string,
  /** tier_id -> product id, for every tier that should stay on sale. */
  keep: Map<string, string>,
): Promise<number> {
  const query = `metadata['event_slug']:'${eventSlug.replace(/'/g, "")}' AND active:'true'`;
  const found = await stripe(key, `/products/search?query=${encodeURIComponent(query)}&limit=100`);
  let archived = 0;
  for (const p of (found?.data ?? []) as { id: string; metadata?: Record<string, string> }[]) {
    if (p.metadata?.kind !== "ticket") continue;
    const tierId = p.metadata?.tier_id ?? "";
    if (keep.get(tierId) === p.id) continue;
    await stripe(key, `/products/${encodeURIComponent(p.id)}`, new URLSearchParams({ active: "false" }))
      .then(() => archived++)
      .catch(() => {});
  }
  return archived;
}

/** The date's name: the posted row's title, else the slug, which reads right in caps. */
export async function eventTitleFor(admin: Admin, slug: string): Promise<string> {
  const detail = await admin.from("event_details").select("title").eq("event_slug", slug).maybeSingle();
  if (detail.data?.title) return String(detail.data.title);
  const row = await admin.from("events").select("title").eq("slug", slug).maybeSingle();
  if (row.data?.title) return String(row.data.title);
  return slug.toUpperCase();
}
