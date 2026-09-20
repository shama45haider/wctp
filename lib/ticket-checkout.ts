"use client";

import { getSupabase } from "./supabase";

/**
 * Hands the cart to the edge function and gets back a Stripe URL.
 *
 * Only tier ids and quantities go over - deliberately no prices. The function
 * reads those out of public.ticket_tiers, so nothing this file sends can
 * change what gets charged. Anything here that looked like an amount would be
 * decoration at best and a hole at worst.
 */

const TIMEOUT_MS = 20_000;

export async function startTicketCheckout(input: {
  eventSlug: string;
  lines: { tierId: string; qty: number }[];
}): Promise<{ url?: string; error?: string }> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return { error: "Not connected." };
  }
  if (!supabase) return { error: "Not connected." };

  const paid = input.lines.filter((l) => l.qty > 0);
  if (paid.length === 0) return { error: "Nothing selected." };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = supabase.functions.invoke<{ url?: string; error?: string }>(
      "create-ticket-checkout",
      {
        body: {
          eventSlug: input.eventSlug,
          lines: paid,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      },
    );

    const res = await Promise.race([
      call,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      }),
    ]);
    if (!res) return { error: "That took too long." };

    // supabase-js puts a non-2xx in `error` and drops the body, so the
    // function's own sentence has to be dug out of the response it attached.
    if (res.error) {
      const body = await (res.error as { context?: Response }).context
        ?.json?.()
        .catch(() => null);
      return { error: body?.error ?? "Checkout could not start." };
    }
    if (!res.data?.url) return { error: res.data?.error ?? "Checkout could not start." };
    return { url: res.data.url };
  } catch {
    return { error: "Checkout could not start." };
  } finally {
    clearTimeout(timer);
  }
}
