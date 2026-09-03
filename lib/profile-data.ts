"use client";

import { getSupabase } from "./supabase";

/**
 * The signed-in guest's own profile row.
 *
 * `verified` is the reason this file exists. It lives in the database - an
 * admin approving an ID sets it there through the trigger in 0002, and a
 * barcode scan on another phone sets it there too - but useAccount was reading
 * it out of this browser's localStorage and nowhere else. Someone whose ID had
 * genuinely been approved still met the "verify your ID first" gate at
 * checkout, because the only copy of that answer this device had ever seen was
 * one it wrote itself.
 *
 * Reads are governed by "read own profile" in 0001_accounts.sql, so this can
 * only ever return the caller's own row.
 */

export type OwnProfile = {
  id: string;
  name: string;
  email: string;
  instagram: string | null;
  phone: string | null;
  verified: boolean;
  birthYear: number | null;
};

/**
 * Only columns 0001 and 0002 created.
 *
 * nickname and avatar_path arrive in 0006, and PostgREST rejects an entire
 * select that names a column the schema does not have rather than returning
 * the rest - so naming them here would break this for every project that has
 * not run that migration yet, which is exactly how the dashboard broke on
 * order_lines.donation.
 */
const COLUMNS = "id,name,email,instagram,phone,verified,birth_year";

const TIMEOUT_MS = 8000;

type Record = {
  id: string;
  name: string | null;
  email: string | null;
  instagram: string | null;
  phone: string | null;
  verified: boolean | null;
  birth_year: number | null;
};

/** `work`, or null if it has not answered inside `ms`. */
function capped<T>(work: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

/**
 * Null covers every way this can fail, because the caller does the same thing
 * about all of them: fall back to what this browser already knew. A profile
 * that cannot be read must never downgrade someone who is verified locally,
 * which is why useAccount ORs the two rather than preferring either.
 */
export async function readOwnProfile(userId: string): Promise<OwnProfile | null> {
  const supabase = safeClient();
  if (!supabase) return null;

  const res = await capped(
    supabase.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle(),
    TIMEOUT_MS,
  );
  if (!res || res.error || !res.data) return null;

  const r = res.data as unknown as Record;
  return {
    id: r.id,
    name: r.name ?? "",
    email: r.email ?? "",
    instagram: r.instagram,
    phone: r.phone,
    verified: Boolean(r.verified),
    birthYear: r.birth_year,
  };
}
