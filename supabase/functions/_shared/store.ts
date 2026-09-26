/**
 * Turns a paid Stripe Checkout Session for a store prize into a store_orders
 * row. Shared by store-order-status (the buyer landing back on the site) and
 * stripe-ticket-webhook (Stripe telling us directly), so whichever arrives
 * first records the sale and the other finds it already there - a buyer who
 * closes the tab before the redirect still gets their prize, and a webhook
 * that is slow still leaves the buyer looking at their QR straight away.
 *
 * Runs on the service role key. Nothing is read from the session except the
 * metadata create-store-checkout wrote and what Stripe itself charged.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

export type StoreOrderRow = {
  id: string;
  product_name: string;
  qty: number;
  amount_cents: number;
  claim_code: string;
  invoice_url: string | null;
  invoice_number: string | null;
  user_id: string | null;
  paid_at: string;
  redeemed_at: string | null;
};

const COLUMNS =
  "id, product_name, qty, amount_cents, claim_code, invoice_url, invoice_number, user_id, paid_at, redeemed_at";

/**
 * 16 characters from a 31-letter alphabet with no 0/O/1/I/L to misread off a
 * cracked screen: about 79 bits, well past guessing, still short enough for a
 * QR a phone reads across a dark room.
 */
function claimCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `PRZ-${out}`;
}

async function readInvoice(invoiceId: string, key: string) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/invoices/${encodeURIComponent(invoiceId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const inv = await res.json();
    return {
      url: (inv.hosted_invoice_url as string | null) ?? null,
      number: (inv.number as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function recordStoreOrder(
  admin: Admin,
  // deno-lint-ignore no-explicit-any
  session: Record<string, any>,
  stripeKey: string | undefined,
): Promise<{ ok: true; order: StoreOrderRow } | { ok: false; error: string }> {
  const sessionId = String(session.id ?? "");
  if (!sessionId) return { ok: false, error: "No session." };
  if (session.payment_status !== "paid") return { ok: false, error: "That payment did not go through." };

  const meta = (session.metadata ?? {}) as Record<string, string>;
  if (meta.kind !== "store") return { ok: false, error: "Not a store payment." };

  const invoiceId: string | null =
    typeof session.invoice === "string" ? session.invoice : session.invoice?.id ?? null;

  const existing = await admin
    .from("store_orders")
    .select(COLUMNS)
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing.data) {
    const found = existing.data as StoreOrderRow;
    // Whichever call recorded it first may have beaten Stripe to finishing
    // the invoice. Fill the link in on the next pass rather than never.
    if (!found.invoice_url && invoiceId && stripeKey) {
      const inv = await readInvoice(invoiceId, stripeKey);
      if (inv?.url) {
        await admin
          .from("store_orders")
          .update({ stripe_invoice_id: invoiceId, invoice_url: inv.url, invoice_number: inv.number })
          .eq("id", found.id);
        found.invoice_url = inv.url;
        found.invoice_number = inv.number;
      }
    }
    return { ok: true, order: found };
  }

  const userId = meta.user_id || null;
  const productId = meta.product_id || null;
  const qty = Math.max(1, Math.min(20, Number(meta.qty) || 1));

  const { data: profile } = userId
    ? await admin.from("profiles").select("name, email, phone, instagram").eq("id", userId).maybeSingle()
    : { data: null };

  const details = (session.customer_details ?? {}) as Record<string, string | null>;
  const invoice = invoiceId && stripeKey ? await readInvoice(invoiceId, stripeKey) : null;

  const row = {
    product_id: productId,
    product_name: meta.product_name || "Prize",
    qty,
    amount_cents: Number(session.amount_total ?? 0),
    user_id: userId,
    buyer_name: profile?.name || details.name || "",
    buyer_email: profile?.email || details.email || String(session.customer_email ?? ""),
    buyer_phone: details.phone || profile?.phone || null,
    buyer_handle: profile?.instagram || null,
    stripe_session_id: sessionId,
    stripe_invoice_id: invoiceId,
    invoice_number: invoice?.number ?? null,
    invoice_url: invoice?.url ?? null,
    claim_code: claimCode(),
    paid_at: new Date().toISOString(),
  };

  const insert = await admin.from("store_orders").insert(row).select(COLUMNS).single();
  if (insert.error) {
    // Two deliveries in flight at once: the webhook and the redirect raced,
    // and the other one won. Same payment - read back what it wrote.
    if (/duplicate key|unique/i.test(insert.error.message)) {
      const again = await admin
        .from("store_orders")
        .select(COLUMNS)
        .eq("stripe_session_id", sessionId)
        .maybeSingle();
      if (again.data) return { ok: true, order: again.data as StoreOrderRow };
    }
    return { ok: false, error: insert.error.message };
  }

  if (productId) await admin.rpc("store_count_sale", { p_product: productId, p_qty: qty });

  return { ok: true, order: insert.data as StoreOrderRow };
}
