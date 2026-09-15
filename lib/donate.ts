"use client";

import { getSupabase } from "./supabase";

/**
 * Asks Stripe, through the Deno functions in supabase/functions, to take a
 * real gift - and reads back the donor board those gifts feed.
 *
 * Nothing here holds a Stripe key, for the same reason nothing in lib/email.ts
 * holds a Resend one: this site is a static export, so anything a page
 * imports is compiled into the JavaScript every visitor downloads. The key
 * lives on create-donation-checkout and donation-status instead; this only
 * carries a request to them and reads back what they say. Returns rather than
 * throws, like the rest of lib/.
 */

/** Long enough for a cold start on a function nobody has called today. */
const TIMEOUT_MS = 20_000;

/** Fired on window once a gift has been recorded, so the board can re-read. */
export const DONOR_BOARD_CHANGED = "wctp:donor-board-changed";

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

export type StartOutcome =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function startDonationCheckout(gift: {
  amountCents: number;
  name: string;
  email: string;
  /** Only applied for a signed-in donor; the function ignores it otherwise. */
  showOnBoard: boolean;
}): Promise<StartOutcome> {
  const supabase = safeClient();
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
  | { ok: true; amountCents: number; name: string; onBoard: boolean }
  | { ok: false; error: string };

export async function confirmDonation(sessionId: string): Promise<DonationOutcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = supabase.functions.invoke<{
      ok?: boolean;
      amountCents?: number;
      name?: string;
      onBoard?: boolean;
      error?: string;
    }>("donation-status", { body: { sessionId } });
    const capped = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });

    const res = await Promise.race([call, capped]);
    if (!res) return { ok: false, error: "Stripe did not answer." };
    if (res.error) return { ok: false, error: (await readError(res.error)) ?? res.error.message };
    if (!res.data?.ok) return { ok: false, error: res.data?.error ?? "That payment did not go through." };
    return {
      ok: true,
      amountCents: res.data.amountCents ?? 0,
      name: res.data.name ?? "",
      onBoard: Boolean(res.data.onBoard),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "The payment could not be confirmed.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export type Donor = {
  /** Bare Instagram handle, or null for a donor who never added one. */
  handle: string | null;
  /** The nickname they chose on their profile, if any. */
  displayName: string | null;
  avatarPath: string | null;
  totalCents: number;
  gifts: number;
};

type DonorRow = {
  handle: string | null;
  display_name: string | null;
  avatar_path: string | null;
  total_cents: number | string;
  gifts: number | string;
};

/**
 * Everyone on the board, biggest total first. A database that hasn't had
 * migration 0017 yet reads as an empty board rather than an error - a guest
 * can't do anything about a missing migration.
 */
export async function loadDonorBoard(): Promise<{ donors: Donor[]; error: string | null }> {
  const supabase = safeClient();
  if (!supabase) return { donors: [], error: null };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const capped = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 8000);
    });
    const res = await Promise.race([Promise.resolve(supabase.rpc("donor_board")), capped]);
    if (!res) return { donors: [], error: "The donor board did not load." };
    if (res.error) {
      const missing =
        /donor_board/i.test(res.error.message) &&
        /does not exist|could not find|schema cache/i.test(res.error.message);
      return { donors: [], error: missing ? null : res.error.message };
    }
    const rows = (res.data ?? []) as DonorRow[];
    return {
      donors: rows.map((r) => ({
        handle: r.handle,
        displayName: r.display_name,
        avatarPath: r.avatar_path,
        totalCents: Number(r.total_cents) || 0,
        gifts: Number(r.gifts) || 0,
      })),
      error: null,
    };
  } catch (e) {
    return {
      donors: [],
      error: e instanceof Error && e.message ? e.message : "The donor board did not load.",
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
