"use client";

import { getSupabase } from "./supabase";

/**
 * The store on the donate page: prizes an admin lists, paid through Stripe,
 * picked up at the next event with a QR.
 *
 * Prices and the record of who paid live in the database (0025_store.sql),
 * and the money goes through create-store-checkout and store-order-status in
 * supabase/functions - this file holds no key and decides no price, it asks
 * and shows the answer. Every function returns rather than throws, like the
 * rest of lib/.
 */

const TIMEOUT_MS = 10_000;
/** Long enough for a cold start on a function nobody has called today. */
const FN_TIMEOUT_MS = 20_000;

export const NEEDS_0025 =
  "The store tables aren't in the database yet - run supabase/APPLY_0025.sql in the Supabase SQL editor.";

export type Product = {
  id: string;
  name: string;
  blurb: string;
  priceCents: number;
  imagePath: string | null;
  /** Null means no limit. */
  stock: number | null;
  sold: number;
  active: boolean;
  sort: number;
};

export type StoreOrder = {
  id: string;
  productId: string | null;
  productName: string;
  qty: number;
  amountCents: number;
  userId: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  buyerHandle: string | null;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  claimCode: string;
  paidAt: string;
  redeemedAt: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  blurb: string | null;
  price_cents: number;
  image_path: string | null;
  stock: number | null;
  sold: number;
  active: boolean;
  sort: number;
};

type OrderRow = {
  id: string;
  product_id: string | null;
  product_name: string;
  qty: number;
  amount_cents: number;
  user_id: string | null;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  buyer_handle: string | null;
  invoice_number: string | null;
  invoice_url: string | null;
  claim_code: string;
  paid_at: string;
  redeemed_at: string | null;
};

const PRODUCT_COLUMNS = "id,name,blurb,price_cents,image_path,stock,sold,active,sort";
const ORDER_COLUMNS =
  "id,product_id,product_name,qty,amount_cents,user_id,buyer_name,buyer_email,buyer_phone,buyer_handle,invoice_number,invoice_url,claim_code,paid_at,redeemed_at";

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

function capped<T>(work: PromiseLike<T>, ms = TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isMissing(message: string) {
  return /store_products|store_orders|redeem_store_order/i.test(message) &&
    /does not exist|could not find|schema cache/i.test(message);
}

function explain(message: string) {
  return isMissing(message) ? NEEDS_0025 : message;
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  name: r.name,
  blurb: r.blurb ?? "",
  priceCents: r.price_cents,
  imagePath: r.image_path,
  stock: r.stock,
  sold: r.sold,
  active: r.active,
  sort: r.sort,
});

const toOrder = (r: OrderRow): StoreOrder => ({
  id: r.id,
  productId: r.product_id,
  productName: r.product_name,
  qty: r.qty,
  amountCents: r.amount_cents,
  userId: r.user_id,
  buyerName: r.buyer_name,
  buyerEmail: r.buyer_email,
  buyerPhone: r.buyer_phone,
  buyerHandle: r.buyer_handle,
  invoiceNumber: r.invoice_number,
  invoiceUrl: r.invoice_url,
  claimCode: r.claim_code,
  paidAt: r.paid_at,
  redeemedAt: r.redeemed_at,
});

/** How many are left, or null for no limit. */
export function leftOf(p: Product): number | null {
  return p.stock === null ? null : Math.max(p.stock - p.sold, 0);
}

/**
 * Everything on the shelf. RLS decides what "everything" is: guests get the
 * active products, an admin also gets the hidden ones. A database without
 * 0025 reads as an empty store for a guest - they can't fix it - and as the
 * reason for an admin, via `error`.
 */
export async function listProducts(): Promise<{ products: Product[]; error: string | null }> {
  const supabase = safeClient();
  if (!supabase) return { products: [], error: null };
  const res = await capped(
    supabase
      .from("store_products")
      .select(PRODUCT_COLUMNS)
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true }),
  );
  if (!res) return { products: [], error: "The store did not load." };
  if (res.error) return { products: [], error: explain(res.error.message) };
  return { products: ((res.data ?? []) as ProductRow[]).map(toProduct), error: null };
}

export type ProductDraft = {
  name: string;
  blurb: string;
  priceCents: number;
  imagePath: string | null;
  stock: number | null;
  active: boolean;
  sort: number;
};

export async function saveProduct(
  id: string | null,
  draft: ProductDraft,
): Promise<{ ok: true; product: Product } | { ok: false; error: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };
  const row = {
    name: draft.name.trim(),
    blurb: draft.blurb.trim(),
    price_cents: draft.priceCents,
    image_path: draft.imagePath,
    stock: draft.stock,
    active: draft.active,
    sort: draft.sort,
    updated_at: new Date().toISOString(),
  };
  const query = id
    ? supabase.from("store_products").update(row).eq("id", id).select(PRODUCT_COLUMNS).single()
    : supabase.from("store_products").insert(row).select(PRODUCT_COLUMNS).single();
  const res = await capped(query);
  if (!res) return { ok: false, error: "The database did not answer. Nothing was saved." };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  return { ok: true, product: toProduct(res.data as ProductRow) };
}

export async function deleteProduct(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };
  const res = await capped(supabase.from("store_products").delete().eq("id", id));
  if (!res) return { ok: false, error: "The database did not answer." };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  return { ok: true };
}

/** Every sale for the dashboard, or just the signed-in buyer's own - RLS decides which. */
export async function listStoreOrders(
  userId?: string,
): Promise<{ orders: StoreOrder[]; error: string | null }> {
  const supabase = safeClient();
  if (!supabase) return { orders: [], error: "Not connected." };
  let query = supabase
    .from("store_orders")
    .select(ORDER_COLUMNS)
    .order("paid_at", { ascending: false })
    .limit(500);
  if (userId) query = query.eq("user_id", userId);
  const res = await capped(query);
  if (!res) return { orders: [], error: "The database did not answer." };
  if (res.error) return { orders: [], error: explain(res.error.message) };
  return { orders: ((res.data ?? []) as OrderRow[]).map(toOrder), error: null };
}

/** An admin reading one order by its claim code, without handing it over. */
export async function findOrderByCode(
  code: string,
): Promise<{ order: StoreOrder | null; error: string | null }> {
  const supabase = safeClient();
  if (!supabase) return { order: null, error: "Not connected." };
  const res = await capped(
    supabase.from("store_orders").select(ORDER_COLUMNS).eq("claim_code", code).maybeSingle(),
  );
  if (!res) return { order: null, error: "The database did not answer." };
  if (res.error) return { order: null, error: explain(res.error.message) };
  return { order: res.data ? toOrder(res.data as OrderRow) : null, error: null };
}

export type RedeemOutcome =
  | { ok: true; justRedeemed: boolean; redeemedAt: string | null }
  | { ok: false; error: string };

export async function redeemOrder(code: string): Promise<RedeemOutcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };
  const res = await capped(supabase.rpc("redeem_store_order", { p_code: code }));
  if (!res) return { ok: false, error: "The database did not answer. Try again." };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  const row = ((res.data ?? []) as { redeemed_at: string | null; just_redeemed: boolean }[])[0];
  if (!row) return { ok: false, error: "No prize has that code." };
  return { ok: true, justRedeemed: row.just_redeemed, redeemedAt: row.redeemed_at };
}

export async function unredeemOrder(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };
  const res = await capped(supabase.rpc("unredeem_store_order", { p_id: id }));
  if (!res) return { ok: false, error: "The database did not answer." };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  return { ok: true };
}

/* --------------------------------------------------------------- buying -- */

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const supabase = safeClient();
  if (!supabase) return { data: null, error: "Not connected." };
  try {
    const res = await capped(supabase.functions.invoke<T>(name, { body }), FN_TIMEOUT_MS);
    if (!res) return { data: null, error: "Stripe did not answer." };
    if (res.error) return { data: null, error: (await readError(res.error)) ?? res.error.message };
    return { data: res.data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error && e.message ? e.message : "That did not go through." };
  }
}

export async function startStoreCheckout(
  productId: string,
  qty: number,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const res = await invoke<{ url?: string; error?: string }>("create-store-checkout", {
    productId,
    qty,
    origin: window.location.origin,
  });
  if (res.error) return { ok: false, error: res.error };
  if (!res.data?.url) return { ok: false, error: res.data?.error ?? "Stripe sent back nothing to pay with." };
  return { ok: true, url: res.data.url };
}

export type PaidPrize = {
  id: string;
  productName: string;
  qty: number;
  amountCents: number;
  claimCode: string;
  invoiceUrl: string | null;
  paidAt: string;
  redeemedAt: string | null;
};

export async function confirmStoreOrder(
  sessionId: string,
): Promise<{ ok: true; order: PaidPrize } | { ok: false; error: string }> {
  const res = await invoke<{ ok?: boolean; order?: PaidPrize; error?: string }>(
    "store-order-status",
    { sessionId },
  );
  if (res.error) return { ok: false, error: res.error };
  if (!res.data?.ok || !res.data.order) {
    return { ok: false, error: res.data?.error ?? "That payment could not be confirmed." };
  }
  return { ok: true, order: res.data.order };
}

/** The address a prize QR opens: the code in the fragment, so it never reaches a server log. */
export function claimUrl(code: string, origin = window.location.origin) {
  return `${origin}/claim#${code}`;
}

/** Fired on window once a prize has been bought, so lists can re-read. */
export const STORE_CHANGED = "wctp:store-changed";

async function readError(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.json();
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}
