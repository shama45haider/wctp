"use client";

import { getSupabase } from "./supabase";

/**
 * What the door needs from the database about one scanned pass, beyond what
 * the QR itself carries.
 *
 * Add-ons are read here and never from the QR. The QR's payload is only
 * tamper-evident, not tamper-proof (see lib/pass-token.ts), so anything worth
 * money has to come from the order a payment actually created. Only an admin
 * session can read another guest's order, which is why /pass only asks when
 * staff are signed in.
 */

export type DoorAddon = { name: string; qty: number };

export type DoorLookup = {
  /** False when no pass with this code exists in the database. */
  found: boolean;
  usedAt: string | null;
  paid: boolean;
  cancelled: boolean;
  addons: DoorAddon[];
  /**
   * Whether the account that bought this pass has been verified by staff.
   * Buying no longer waits for it, so the door is where an unverified holder
   * gets caught. Null when there is no account to ask about.
   */
  verified: boolean | null;
};

export async function lookupPass(
  code: string,
  orderId: string,
): Promise<{ data?: DoorLookup; error?: string }> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return { error: "Not connected." };
  }
  if (!supabase) return { error: "Not connected." };

  const [pass, order, lines] = await Promise.all([
    supabase.from("passes").select("used_at").eq("code", code).maybeSingle(),
    supabase
      .from("orders")
      .select("total_cents, paid_at, cancelled_at, user_id")
      .eq("id", orderId)
      .maybeSingle(),
    supabase.from("order_lines").select("tier_id, tier_name, qty").eq("order_id", orderId),
  ]);

  if (pass.error) return { error: pass.error.message };
  if (lines.error) return { error: lines.error.message };

  const o = order.data as {
    total_cents: number;
    paid_at?: string | null;
    cancelled_at: string | null;
    user_id?: string | null;
  } | null;

  let verified: boolean | null = null;
  if (o?.user_id) {
    const holder = await supabase
      .from("profiles")
      .select("verified")
      .eq("id", o.user_id)
      .maybeSingle();
    if (!holder.error && holder.data) verified = Boolean((holder.data as { verified: boolean }).verified);
  }

  return {
    data: {
      found: Boolean(pass.data),
      usedAt: (pass.data as { used_at: string | null } | null)?.used_at ?? null,
      paid: Boolean(o && (o.paid_at || o.total_cents === 0)),
      cancelled: Boolean(o?.cancelled_at),
      addons: ((lines.data ?? []) as { tier_id: string; tier_name: string; qty: number }[])
        .filter((l) => l.tier_id.startsWith("addon:"))
        .map((l) => ({ name: l.tier_name, qty: l.qty })),
      verified,
    },
  };
}

/** Marks a pass used for every door at once. Admin only, by policy. */
export async function markPassUsed(code: string): Promise<{ ok: boolean; at?: string; error?: string }> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return { ok: false, error: "Not connected." };
  }
  if (!supabase) return { ok: false, error: "Not connected." };

  const { data: auth } = await supabase.auth.getUser();
  const at = new Date().toISOString();
  const { data, error } = await supabase
    .from("passes")
    .update({ used_at: at, used_by: auth.user?.id ?? null })
    .eq("code", code)
    .is("used_at", null)
    .select("used_at");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Already used, or not found." };
  }
  return { ok: true, at };
}
