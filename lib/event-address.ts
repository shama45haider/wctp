"use client";

import { getSupabase } from "./supabase";

/**
 * A date's address - kept from everyone but admins until the day before,
 * when send-event-addresses emails it to each ticket holder (0029).
 *
 * The dashboard reads and writes it here under the admin's own session; row
 * level security is what keeps it private, not this file. Every function
 * returns rather than throws, like the rest of lib/.
 */

const TIMEOUT_MS = 10_000;
/** Long enough for the send function's cold start plus a batch to Resend. */
const SEND_TIMEOUT_MS = 30_000;

export const NEEDS_0029 =
  "The address table isn't in the database yet - run supabase/APPLY_0029.sql in the Supabase SQL editor.";

export type AddressEvent = {
  slug: string;
  title: string;
  /** YYYY-MM-DD. */
  date: string;
  /** As printed: "10:00 PM". */
  doors: string;
};

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

const explain = (message: string) =>
  /event_details|address_sent_at/i.test(message) && /does not exist|could not find|schema cache/i.test(message)
    ? NEEDS_0029
    : message;

export async function loadAddress(
  slug: string,
): Promise<{ address: string; updatedAt: string | null; error: string | null }> {
  const supabase = safeClient();
  if (!supabase) return { address: "", updatedAt: null, error: "Not connected." };
  const res = await capped(
    supabase.from("event_details").select("address, updated_at").eq("event_slug", slug).maybeSingle(),
  );
  if (!res) return { address: "", updatedAt: null, error: "The database did not answer." };
  if (res.error) return { address: "", updatedAt: null, error: explain(res.error.message) };
  const row = res.data as { address: string; updated_at: string } | null;
  return { address: row?.address ?? "", updatedAt: row?.updated_at ?? null, error: null };
}

/** Saves the address with the date's title, day and doors, which the send function can't look up. */
export async function saveAddress(e: AddressEvent, address: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };
  const res = await capped(
    supabase.from("event_details").upsert(
      {
        event_slug: e.slug,
        title: e.title,
        event_date: e.date,
        doors: e.doors,
        address: address.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_slug" },
    ),
  );
  if (!res) return { ok: false, error: "The database did not answer. Nothing was saved." };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  return { ok: true };
}

/** Paid, uncancelled orders on a date, and how many of them have had the address. */
export async function holderCounts(
  slug: string,
): Promise<{ holders: number; sent: number | null } | null> {
  const supabase = safeClient();
  if (!supabase) return null;
  const base = () =>
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("event_slug", slug)
      .not("paid_at", "is", null)
      .is("cancelled_at", null);
  const [all, sent] = await Promise.all([
    capped(base()),
    capped(base().not("address_sent_at", "is", null)),
  ]);
  if (!all || all.error) return null;
  return { holders: all.count ?? 0, sent: sent && !sent.error ? (sent.count ?? 0) : null };
}

/** Emails the saved address to every holder who hasn't had it yet, now. */
export async function sendAddressNow(
  slug: string,
): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };
  try {
    const res = await capped(
      supabase.functions.invoke<{ ok?: boolean; error?: string; dates?: { sent: number; failed?: string }[] }>(
        "send-event-addresses",
        { body: { slug } },
      ),
      SEND_TIMEOUT_MS,
    );
    if (!res) return { ok: false, error: "The email service did not answer." };
    if (res.error) {
      const context = (res.error as { context?: unknown }).context;
      if (context instanceof Response) {
        const body = await context.json().catch(() => null);
        if (typeof body?.error === "string") return { ok: false, error: explain(body.error) };
      }
      return { ok: false, error: res.error.message };
    }
    const date = res.data?.dates?.[0];
    if (date?.failed) return { ok: false, error: date.failed };
    return { ok: true, sent: date?.sent ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : "That did not go through." };
  }
}
