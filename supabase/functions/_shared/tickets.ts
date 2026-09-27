/**
 * Turns a paid Stripe Checkout Session for tickets into an order, its lines
 * and its passes. Shared by stripe-ticket-webhook (Stripe telling us) and
 * ticket-order-status (the buyer landing back on the site), so whichever
 * arrives first records the sale and the other finds it already there - the
 * same arrangement _shared/store.ts has for prizes.
 *
 * Runs on the service role key. Nothing is read from the session except the
 * metadata create-ticket-checkout wrote and what Stripe itself charged.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

/** WCTP-XXXXXX, the shape the rest of the site expects an order id to be. */
function orderId() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `WCTP-${out}`;
}

type TicketLine = { t: string; n: string; u: number; q: number; a: number };
type AddonLine = { i: string; n: string; u: number; q: number };

export async function recordTicketOrder(
  admin: Admin,
  // deno-lint-ignore no-explicit-any
  session: Record<string, any>,
): Promise<{ ok: true; orderId: string } | { ok: false; error: string; retry?: boolean }> {
  const sessionId = String(session.id ?? "");
  if (!sessionId) return { ok: false, error: "No session." };
  if (session.payment_status !== "paid") return { ok: false, error: "That payment did not go through." };

  const meta = (session.metadata ?? {}) as Record<string, string>;
  const userId = meta.user_id;
  const eventSlug = meta.event_slug;
  if (!userId || !eventSlug) return { ok: false, error: "Not a ticket payment." };

  let lines: TicketLine[];
  let addons: AddonLine[];
  try {
    lines = JSON.parse(meta.lines ?? "[]");
    addons = JSON.parse(meta.addons ?? "[]");
  } catch {
    return { ok: false, error: "Bad metadata." };
  }
  if (lines.length === 0) return { ok: false, error: "No tickets on that payment." };

  // Already handled? Stripe delivers more than once by design, and the
  // redirect races it.
  const { data: seen } = await admin
    .from("orders")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  let resumeId: string | null = null;
  if (seen) {
    // Done only if its passes landed. An attempt that wrote the order and then
    // failed is finished here rather than left as a paid order with no tickets.
    const { count } = await admin
      .from("passes")
      .select("code", { count: "exact", head: true })
      .eq("order_id", seen.id);
    if (count) return { ok: true, orderId: seen.id as string };
    resumeId = seen.id as string;
  }

  // What Stripe actually took, not what the site expected it to.
  const total = Number(session.amount_total ?? 0);
  const subtotal = Number(meta.subtotal_cents ?? 0);
  const fee = Number(meta.fee_cents ?? 0);

  const { data: profile } = await admin
    .from("profiles")
    .select("name, instagram, email, phone")
    .eq("id", userId)
    .maybeSingle();

  const { data: eventRow } = await admin
    .from("events")
    .select("title")
    .eq("slug", eventSlug)
    .maybeSingle();

  const id = resumeId ?? orderId();
  const { error: orderErr } = resumeId ? { error: null } : await admin.from("orders").insert({
    id,
    user_id: userId,
    event_slug: eventSlug,
    event_title: meta.event_title || eventRow?.title || eventSlug,
    subtotal_cents: subtotal,
    discount_cents: 0,
    fee_cents: fee,
    total_cents: total,
    // The door reads the handle, so the ticket carries it when there is one.
    buyer_name: profile?.instagram ? `@${profile.instagram}` : (profile?.name ?? ""),
    buyer_email: profile?.email ?? String(session.customer_email ?? ""),
    buyer_phone: profile?.phone ?? null,
    paid_at: new Date().toISOString(),
    stripe_session_id: sessionId,
  });

  if (orderErr) {
    // The race the check above cannot close: both callers in flight at once.
    // Same payment - read back what the winner wrote.
    if (/duplicate key|unique/i.test(orderErr.message)) {
      const { data: again } = await admin
        .from("orders")
        .select("id")
        .eq("stripe_session_id", sessionId)
        .maybeSingle();
      if (again) return { ok: true, orderId: again.id as string };
    }
    return { ok: false, error: `order failed: ${orderErr.message}`, retry: true };
  }

  // Resuming: clear any lines the failed attempt left, so they are not doubled.
  if (resumeId) await admin.from("order_lines").delete().eq("order_id", id);

  const rows = [
    ...lines.map((l) => ({
      order_id: id,
      tier_id: l.t,
      tier_name: l.n,
      qty: l.q,
      unit_cents: l.u,
      admits: l.a,
      donation: false,
      addon: false,
    })),
    ...addons.map((a) => ({
      order_id: id,
      tier_id: `addon:${a.i}`,
      tier_name: a.n,
      qty: a.q,
      unit_cents: a.u,
      admits: 0,
      donation: false,
      addon: true,
    })),
  ];
  const { error: lineErr } = await admin.from("order_lines").insert(rows);
  if (lineErr) return { ok: false, error: `lines failed: ${lineErr.message}`, retry: true };

  const passes: Record<string, unknown>[] = [];
  for (const l of lines) {
    for (let i = 0; i < l.q; i++) {
      passes.push({
        code: `${id}-${l.t.toUpperCase().slice(0, 12)}-${i + 1}`,
        order_id: id,
        tier_id: l.t,
        tier_name: l.n,
        admits: l.a,
        price_cents: l.u,
      });
    }
  }
  const { error: passErr } = await admin
    .from("passes")
    .upsert(passes, { onConflict: "code", ignoreDuplicates: true });
  if (passErr) return { ok: false, error: `passes failed: ${passErr.message}`, retry: true };

  for (const l of lines) {
    await admin.rpc("ticket_count_sale", { p_event: eventSlug, p_tier: l.t, p_qty: l.q });
  }

  return { ok: true, orderId: id };
}
