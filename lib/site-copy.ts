"use client";

import { getSupabase } from "./supabase";

/**
 * Saved overrides for page text, keyed like "home.archive.blurb". See
 * supabase/migrations/0014_site_copy.sql and components/Editable.tsx.
 *
 * Returns rather than throws, like lib/site-content.ts: a copy table that
 * did not answer must leave the bundled text on screen, not take the page
 * down with it.
 */

type Outcome = { ok: boolean; error?: string };

const TIMEOUT_MS = 8000;
const NOT_CONNECTED = "Not connected.";
const UNREACHABLE = "The database did not answer.";
export const NEEDS_0014 =
  "This project has not run migration 0014 yet, so there is nowhere to save page text.";

function isMissingSchema(message: string) {
  return /site_copy/i.test(message) && /does not exist|could not find|schema cache/i.test(message);
}

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

function capped<T>(work: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const asError = (message: string) => (isMissingSchema(message) ? NEEDS_0014 : message);

export async function loadCopy(): Promise<{ copy: Map<string, string>; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { copy: new Map() };

  const res = await capped(supabase.from("site_copy").select("key,value"), TIMEOUT_MS);
  if (!res) return { copy: new Map(), error: UNREACHABLE };
  if (res.error) return { copy: new Map(), error: asError(res.error.message) };

  const rows = (res.data ?? []) as { key: string; value: string }[];
  return { copy: new Map(rows.map((r) => [r.key, r.value])) };
}

export async function saveCopy(key: string, value: string): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase
      .from("site_copy")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" })
      .select("key"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: asError(res.error.message) };
  // A write a policy refuses changes nothing and says nothing about it.
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing saved - this account is not an admin." };
  }
  return { ok: true };
}

/** Drops the override, handing the text back to whatever the bundle says. */
export async function resetCopy(key: string): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase.from("site_copy").delete().eq("key", key).select("key"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: asError(res.error.message) };
  return { ok: true };
}
