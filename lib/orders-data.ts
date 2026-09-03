import { getSupabase } from "./supabase";
import type { Buyer, Order, Pass } from "./demo-account";
import type { OrderLine } from "./tickets";

/**
 * Puts a placed order into the database and reads it back for other devices.
 *
 * placeOrder() in demo-account.tsx builds the Order object and shows it on
 * screen the instant payment "clears" - nothing here may block that, because
 * the confirmation and the QR codes are already correct without a network
 * call. This module exists so the same order is still there the next time the
 * guest opens the site on a different phone, which orders/order_lines/passes
 * were built for from the start but nothing ever actually wrote to.
 */

type Outcome = { ok: boolean; error?: string };

function messageOf(e: unknown, fallback: string) {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Writes an order and its lines and passes.
 *
 * Best effort, not a transaction - PostgREST has no multi-table transaction
 * over REST. The order row goes first because order_lines and passes carry a
 * foreign key to it and their insert policies check that key resolves to a
 * row this user owns; if either insert after it fails, the order row is left
 * in place rather than rolled back; a retry upserts onto the same id rather
 * than duplicate it.
 */
export async function syncOrder(order: Order, userId: string): Promise<Outcome> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not connected." };

  const { error: orderErr } = await supabase.from("orders").upsert({
    id: order.id,
    user_id: userId,
    event_slug: order.eventSlug,
    event_title: order.eventTitle,
    promo_code: order.promoCode ?? null,
    subtotal_cents: order.subtotalCents,
    discount_cents: order.discountCents,
    fee_cents: order.feeCents,
    total_cents: order.totalCents,
    buyer_name: order.buyer.name,
    buyer_email: order.buyer.email,
    buyer_phone: order.buyer.phone ?? null,
    created_at: order.createdAt,
  });
  if (orderErr) return { ok: false, error: messageOf(orderErr, "The order did not save.") };

  if (order.lines.length > 0) {
    const { error } = await supabase.from("order_lines").insert(
      order.lines.map((l) => ({
        order_id: order.id,
        tier_id: l.tierId,
        tier_name: l.tierName,
        qty: l.qty,
        unit_cents: l.unitCents,
        admits: l.admits,
        donation: l.donation ?? false,
      })),
    );
    // Duplicate-key here means a previous attempt already wrote these lines
    // for this order id - not a real failure, so it is not reported as one.
    if (error && error.code !== "23505") {
      return { ok: false, error: messageOf(error, "The order lines did not save.") };
    }
  }

  if (order.passes.length > 0) {
    const { error } = await supabase.from("passes").insert(
      order.passes.map((p) => ({
        code: p.code,
        order_id: order.id,
        tier_id: p.tierId,
        tier_name: p.tierName,
        admits: p.admits,
        price_cents: p.priceCents,
      })),
    );
    if (error && error.code !== "23505") {
      return { ok: false, error: messageOf(error, "The passes did not save.") };
    }
  }

  return { ok: true };
}

type OrderRow = {
  id: string;
  event_slug: string;
  event_title: string;
  promo_code: string | null;
  subtotal_cents: number;
  discount_cents: number;
  fee_cents: number;
  total_cents: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  created_at: string;
  order_lines: {
    tier_id: string;
    tier_name: string;
    qty: number;
    unit_cents: number;
    admits: number;
    donation: boolean;
  }[];
  passes: {
    code: string;
    tier_id: string;
    tier_name: string;
    admits: number;
    price_cents: number;
  }[];
};

function toOrder(row: OrderRow): Order {
  const buyer: Buyer = {
    name: row.buyer_name,
    email: row.buyer_email,
    phone: row.buyer_phone ?? undefined,
  };
  const lines: OrderLine[] = row.order_lines.map((l) => ({
    tierId: l.tier_id,
    tierName: l.tier_name,
    qty: l.qty,
    unitCents: l.unit_cents,
    admits: l.admits,
    donation: l.donation || undefined,
  }));
  const passes: Pass[] = row.passes.map((p) => ({
    code: p.code,
    tierId: p.tier_id,
    tierName: p.tier_name,
    admits: p.admits,
    priceCents: p.price_cents,
  }));

  return {
    id: row.id,
    eventSlug: row.event_slug,
    eventTitle: row.event_title,
    lines,
    promoCode: row.promo_code ?? undefined,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    feeCents: row.fee_cents,
    totalCents: row.total_cents,
    buyer,
    passes,
    createdAt: row.created_at,
  };
}

/**
 * This user's orders, newest first, cancelled ones left out - matching what
 * cancelOrder() has always done to the local list.
 *
 * The row-level security policy also lets an admin session read every user's
 * orders, since the dashboard needs that. Filtering to userId here is what
 * keeps this particular call - a guest opening their own /account - from
 * handing an admin's session back the entire order book.
 */
export async function listOrders(
  userId: string,
): Promise<{ orders: Order[]; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { orders: [], error: "Not connected." };

  const { data, error } = await supabase
    .from("orders")
    .select("*, order_lines(*), passes(*)")
    .eq("user_id", userId)
    .is("cancelled_at", null)
    .order("created_at", { ascending: false });

  if (error) return { orders: [], error: messageOf(error, "Orders did not load.") };
  return { orders: ((data ?? []) as OrderRow[]).map(toOrder) };
}

/** Soft delete: there is no delete policy on orders, only this update. */
export async function cancelOrderInDb(orderId: string): Promise<Outcome> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not connected." };

  const { error } = await supabase
    .from("orders")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", orderId);

  if (error) return { ok: false, error: messageOf(error, "The order was not cancelled.") };
  return { ok: true };
}
