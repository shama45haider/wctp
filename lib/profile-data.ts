"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { normalizeHandle } from "./handle";

/**
 * The signed-in guest's own profile row, and the things they may change on it.
 *
 * `verified` is the reason the read exists. It lives in the database and
 * nowhere else: an admin approving an age check sets it there through the
 * trigger in 0002, an admin reset clears it there through 0010, and nothing in
 * this browser ever decides it. There used to be a second, local copy of
 * "verified" written by the barcode scanner; that scanner is gone, and with it
 * the whole idea that a phone could clear its own owner.
 *
 * `latestCheck` is the most recent verifications row the guest has filed, so
 * the site can tell "not checked yet", "with us, waiting on a person" and
 * "refused, here is why" apart. Without it every unverified guest would be
 * asked to send their ID again, including the ones who already had.
 *
 * Columns arrive across migrations - nickname and avatar_path in 0006,
 * verification_reset_at in 0010, first_name and age in 0011 - and PostgREST
 * rejects an entire select over one column the schema does not have rather
 * than returning the rest. So the read falls back through the shapes each
 * migration left behind, and the writes say plainly which one is missing.
 */

export type CheckStatus = "pending" | "approved" | "rejected";

export type OwnCheck = {
  id: string;
  status: CheckStatus;
  createdAt: string;
  /** What the reviewer wrote, if anything. Shown to the guest on a refusal. */
  note: string | null;
  documentKind: string | null;
};

export type OwnProfile = {
  id: string;
  /**
   * The account's name, which is its Instagram handle without the @. An
   * account from before 0011 may still carry whatever it signed up with until
   * a handle is added on /profile.
   */
  name: string;
  firstName: string | null;
  /** What they said at sign-up. The reviewed year is `birthYear`. */
  age: number | null;
  email: string;
  /** Handle without the @, or null on a legacy account that never gave one. */
  instagram: string | null;
  phone: string | null;
  verified: boolean;
  /** Year only, and only once a review approved it. */
  birthYear: number | null;
  avatarPath: string | null;
  /** When an admin last sent them back through the check, or null. */
  verificationResetAt: string | null;
  latestCheck: OwnCheck | null;
};

const BASE_COLUMNS = "id,name,email,instagram,phone,verified,birth_year";
/** Through 0010. */
const MID_COLUMNS = `${BASE_COLUMNS},nickname,avatar_path,verification_reset_at`;
/** With 0011. */
const FULL_COLUMNS = `${MID_COLUMNS},first_name,age`;
const CHECK_COLUMNS = "id,status,created_at,note,document_kind";

const AVATARS = "avatars";
const TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** 4MB. A profile picture has no business being larger than a ticket photo. */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

export const NEEDS_0006 =
  "This project has not run migration 0006 yet, so there is nowhere to save a picture.";
export const NEEDS_0011 =
  "This project has not run migration 0011 yet, so a first name and age cannot be saved.";

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
  first_name?: string | null;
  age?: number | null;
};

type CheckRecord = {
  id: string;
  status: CheckStatus;
  created_at: string;
  note: string | null;
  document_kind: string | null;
};

/** PostgREST's wording for a column the schema does not have. */
const MISSING = /does not exist|could not find/i;

function missing0011(message: string) {
  return /first_name|\bage\b/i.test(message) && MISSING.test(message);
}

function missing0006(message: string) {
  return /nickname|avatar_path|verification_reset_at/i.test(message) && MISSING.test(message);
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

function toProfile(r: ProfileRecord, check: OwnCheck | null): OwnProfile {
  return {
    id: r.id,
    name: r.name ?? "",
    firstName: r.first_name ?? null,
    age: r.age ?? null,
    email: r.email ?? "",
    instagram: r.instagram ? normalizeHandle(r.instagram) ?? r.instagram : null,
    phone: r.phone,
    verified: Boolean(r.verified),
    birthYear: r.birth_year,
    avatarPath: r.avatar_path ?? null,
    verificationResetAt: r.verification_reset_at ?? null,
    latestCheck: check,
  };
}

function toCheck(r: CheckRecord): OwnCheck {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    note: r.note,
    documentKind: r.document_kind,
  };
}

type Client = NonNullable<ReturnType<typeof safeClient>>;

async function readProfileRow(supabase: Client, userId: string) {
  const get = (columns: string) =>
    capped(
      supabase.from("profiles").select(columns).eq("id", userId).maybeSingle(),
      TIMEOUT_MS,
    );

  let res = await get(FULL_COLUMNS);
  if (res?.error && missing0011(res.error.message)) res = await get(MID_COLUMNS);
  if (res?.error && missing0006(res.error.message)) res = await get(BASE_COLUMNS);
  if (!res || res.error || !res.data) return null;
  return res.data as unknown as ProfileRecord;
}

/**
 * The newest check on file, or null - which covers "none filed" and "could not
 * read" alike, because the guest can do the same thing about either: file one.
 * "read own verifications" in 0002 is what lets this read succeed.
 */
async function readLatestCheck(supabase: Client, userId: string) {
  const res = await capped(
    supabase
      .from("verifications")
      .select(CHECK_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    TIMEOUT_MS,
  );
  if (!res || res.error || !res.data) return null;
  return toCheck(res.data as unknown as CheckRecord);
}

/**
 * Null covers every way this can fail, and the caller treats all of them the
 * same way: as "not verified, nothing on file", which is the safe reading.
 */
export async function readOwnProfile(userId: string): Promise<OwnProfile | null> {
  const supabase = safeClient();
  if (!supabase) return null;

  const [row, check] = await Promise.all([
    readProfileRow(supabase, userId),
    readLatestCheck(supabase, userId),
  ]);
  if (!row) return null;
  return toProfile(row, check);
}

/**
 * The profile behind a user id, re-read whenever the id changes and whenever
 * `reload` is called - after an age check is filed, after the profile is
 * saved - so a screen never shows a status the database has moved past.
 *
 * `loaded` is true once there is an answer for this id, including the answer
 * that the read failed. Anything that gates on `verified` should wait for it:
 * before it lands, a verified guest looks exactly like an unverified one.
 */
export function useOwnProfile(userId: string | undefined) {
  const [state, setState] = useState<{ id: string; profile: OwnProfile | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readOwnProfile(userId).then((profile) => {
      if (live) setState({ id: userId, profile });
    });
    return () => {
      live = false;
    };
  }, [userId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const current = userId && state?.id === userId ? state.profile : null;
  return {
    profile: current,
    loaded: !userId || state?.id === userId,
    reload,
  };
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
    if (/bucket/i.test(up.error.message) && /not found/i.test(up.error.message)) {
      return { error: NEEDS_0006 };
    }
    return { error: up.error.message };
  }
  return { path };
}

export type ProfilePatch = {
  firstName?: string | null;
  /**
   * Anything a person might type: with or without the @, or a pasted link.
   * Normalised before it is written, and the account's `name` moves with it -
   * the handle is the name, so the two can never be set to disagree.
   */
  instagram?: string | null;
  phone?: string | null;
  avatarPath?: string | null;
};

/**
 * The things a guest may change about themselves.
 *
 * verified, birth_year and verification_reset_at are not on this list and
 * cannot be: the trigger in 0011 refuses them from a guest's session.
 */
export async function updateOwnProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: "Not connected." };

  const row: Record<string, unknown> = {};
  if (patch.firstName !== undefined) row.first_name = patch.firstName?.trim() || null;
  if (patch.phone !== undefined) row.phone = patch.phone?.replace(/\D/g, "") || null;
  if (patch.avatarPath !== undefined) row.avatar_path = patch.avatarPath;
  if (patch.instagram !== undefined) {
    const typed = patch.instagram?.trim() ?? "";
    if (typed) {
      const handle = normalizeHandle(typed);
      if (!handle) {
        return {
          ok: false,
          error: "That does not look like an Instagram handle - letters, numbers, underscores and full stops, up to 30.",
        };
      }
      row.instagram = handle;
      row.name = handle;
    } else {
      row.instagram = null;
    }
  }
  if (Object.keys(row).length === 0) return { ok: true };

  const res = await capped(
    supabase.from("profiles").update(row).eq("id", userId).select("id"),
    TIMEOUT_MS,
  );

  if (!res) return { ok: false, error: "The database did not answer." };
  if (res.error) {
    if (missing0011(res.error.message)) return { ok: false, error: NEEDS_0011 };
    if (missing0006(res.error.message)) return { ok: false, error: NEEDS_0006 };
    return { ok: false, error: res.error.message };
  }
  // An update a policy refuses changes nothing and says nothing about it.
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing was saved - that row is not yours." };
  }
  return { ok: true };
}
