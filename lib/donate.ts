"use client";

import { getSupabase } from "./supabase";

/**
 * Asks Stripe, through the two Deno functions in supabase/functions, to take
 * a real gift.
 *
 * Nothing here holds a Stripe key, for the same reason nothing in lib/email.ts
 * holds a Resend one: this site is a static export, so anything a page
 * imports is compiled into the JavaScript every visitor downloads. The key
 * lives on create-donation-checkout and donation-status instead; this only
 * carries a request to them and reads back what they say. Returns rather than
 * throws, like the rest of lib/ - a payment that did not start, or a session
 * that did not confirm, is something to put on the screen, not something to
 * take a page down with.
 */

/** Long enough for a cold start on a function nobody has called today. */
const TIMEOUT_MS = 20_000;

export type StartOutcome =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function startDonationCheckout(gift: {
  amountCents: number;
  name: string;
  email: string;
}): Promise<StartOutcome> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    supabase = null;
  }
  if (!supabase) return { ok: false, error: "Not connected." };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = supabase.functions.invoke<{ url?: string; error?: string }>(
      "create-donation-checkout",
      {
        body: {
          ...gift,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      },
    );
    const capped = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });

    const res = await Promise.race([call, capped]);
    if (!res) return { ok: false, error: "Stripe did not answer." };
    if (res.error) return { ok: false, error: (await readError(res.error)) ?? res.error.message };
    if (!res.data?.url) return { ok: false, error: res.data?.error ?? "Stripe sent back nothing to pay with." };
    return { ok: true, url: res.data.url };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "The payment did not start.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export type DonationOutcome =
  | { ok: true; amountCents: number; name: string }
  | { ok: false; error: string };

export async function confirmDonation(sessionId: string): Promise<DonationOutcome> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    supabase = null;
  }
  if (!supabase) return { ok: false, error: "Not connected." };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = supabase.functions.invoke<{
      ok?: boolean;
      amountCents?: number;
      name?: string;
      error?: string;
    }>("donation-status", { body: { sessionId } });
    const capped = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });

    const res = await Promise.race([call, capped]);
    if (!res) return { ok: false, error: "Stripe did not answer." };
    if (res.error) return { ok: false, error: (await readError(res.error)) ?? res.error.message };
    if (!res.data?.ok) return { ok: false, error: res.data?.error ?? "That payment did not go through." };
    return { ok: true, amountCents: res.data.amountCents ?? 0, name: res.data.name ?? "" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "The payment could not be confirmed.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The function's own message out of a FunctionsHttpError, when there is one. */
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
