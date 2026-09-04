"use client";

import { getSupabase } from "./supabase";

/**
 * The signed-in guest's own profile row: reading it, and the two things they
 * are allowed to change about it.
 *
 * `verified` is the reason the read exists. It lives in the database - an
 * admin approving an ID sets it there through the trigger in 0002, and a check
 * done on another phone sets it there too - but useAccount was reading it out
 * of this browser's localStorage and nowhere else, so someone whose ID had
 * genuinely been approved still met the gate at checkout.
 *
 * `nickname` and `avatar_path` arrive in 0006. Everything here works without
 * them: PostgREST rejects an entire select over one column the schema does not
 * have rather than returning the rest, which is exactly how the admin
 * dashboard broke on order_lines.donation, so the read falls back to the
 * columns 0001 and 0002 created and the writes say plainly what is missing.
 */

export type OwnProfile = {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  instagram: string | null;
  phone: string | null;
  verified: boolean;
  birthYear: number | null;
  avatarPath: string | null;
  /**
   * When an admin last sent them back through the check, or null. The site
   * drops any local "verified" older than this - see useAccount.
   */
  verificationResetAt: string | null;
};

const BASE_COLUMNS = "id,name,email,instagram,phone,verified,birth_year";
const FULL_COLUMNS = `${BASE_COLUMNS},nickname,avatar_path,verification_reset_at`;

const AVATARS = "avatars";
const TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** 4MB. A profile picture has no business being larger than a ticket photo. */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

/** The migration that adds what this file's optional half depends on. */
export const NEEDS_0006 =
  "This project has not run migration 0006 yet, so there is nowhere to save a nickname or a picture.";

type ProfileRecord = {
  id: string;
  name: string | null;
  email: string | null;
  instagram: string | null;
  phone: string | null;
  verified: boolean | null;
  birth_year: number | null;
  nickname?: string | null;
  avatar_path?: string | null;
  verification_reset_at?: string | null;
};

function isMissingColumn(message: string) {
  return (
    /nickname|avatar_path|verification_reset_at/i.test(message) &&
    /does not exist|could not find/i.test(message)
  );
}

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

function toProfile(r: ProfileRecord): OwnProfile {
  return {
    id: r.id,
    name: r.name ?? "",
    nickname: r.nickname ?? null,
    email: r.email ?? "",
    instagram: r.instagram,
    phone: r.phone,
    verified: Boolean(r.verified),
    birthYear: r.birth_year,
    avatarPath: r.avatar_path ?? null,
    verificationResetAt: r.verification_reset_at ?? null,
  };
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

  const get = (columns: string) =>
    capped(
      supabase.from("profiles").select(columns).eq("id", userId).maybeSingle(),
      TIMEOUT_MS,
    );

  let res = await get(FULL_COLUMNS);
  if (res?.error && isMissingColumn(res.error.message)) res = await get(BASE_COLUMNS);
  if (!res || res.error || !res.data) return null;

  return toProfile(res.data as unknown as ProfileRecord);
}

/** The public URL for a stored avatar. The bucket is public - see 0006. */
export function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  const supabase = safeClient();
  if (!supabase) return null;
  return supabase.storage.from(AVATARS).getPublicUrl(path).data.publicUrl ?? null;
}

/**
 * Puts a picture in the guest's own folder and returns its path.
 *
 * The first segment has to be their user id or the policy in 0006 refuses the
 * write, the same rule id-documents uses. A timestamp rather than a fixed name
 * so a replacement cannot be served from a cache of the old one.
 */
export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<{ path?: string; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { error: "Not connected." };

  if (!file.type.startsWith("image/")) {
    return { error: "That is not an image." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return {
      error: `That picture is ${(file.size / (1024 * 1024)).toFixed(1)} MB, and the limit is 4 MB.`,
    };
  }

  const ext = (file.name.split(".").pop() ?? "jpg")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 5)
    .toLowerCase();
  const path = `${userId}/${Date.now()}.${ext || "jpg"}`;

  const up = await capped(
    supabase.storage.from(AVATARS).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    }),
    UPLOAD_TIMEOUT_MS,
  );

  if (!up) return { error: "The upload did not finish. Nothing was saved." };
  if (up.error) {
    // A missing bucket is 0006 not having been run, which is worth saying
    // rather than passing along "Bucket not found".
    if (/bucket/i.test(up.error.message) && /not found/i.test(up.error.message)) {
      return { error: NEEDS_0006 };
    }
    return { error: up.error.message };
  }
  return { path };
}

/** The two things a guest may change about themselves. */
export async function updateOwnProfile(
  userId: string,
  patch: { nickname?: string | null; avatarPath?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };

  const row: Record<string, unknown> = {};
  if (patch.nickname !== undefined) row.nickname = patch.nickname || null;
  if (patch.avatarPath !== undefined) row.avatar_path = patch.avatarPath;
  if (Object.keys(row).length === 0) return { ok: true };

  const res = await capped(
    supabase.from("profiles").update(row).eq("id", userId).select("id"),
    TIMEOUT_MS,
  );

  if (!res) return { ok: false, error: "The database did not answer." };
  if (res.error) {
    if (isMissingColumn(res.error.message)) return { ok: false, error: NEEDS_0006 };
    return { ok: false, error: res.error.message };
  }
  // An update a policy refuses changes nothing and says nothing about it.
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing was saved - that row is not yours." };
  }
  return { ok: true };
}
