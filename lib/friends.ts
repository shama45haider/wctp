"use client";

import { getSupabase } from "./supabase";

/**
 * Friends, addressed by Instagram handle.
 *
 * Every read goes through a security definer function in 0020, because
 * profiles is readable only by its owner - a friend list assembled from a
 * plain join would come back empty. Nothing here can see more of somebody than
 * their handle and their picture.
 */

export type Friend = {
  userId: string;
  handle: string;
  avatarPath: string | null;
  status: "pending" | "accepted";
  /** Who asked. Decides whether a pending row offers Accept or just waits. */
  direction: "sent" | "received";
  createdAt: string;
};

export type FoundMember = {
  id: string;
  handle: string;
  avatarPath: string | null;
};

const NOT_CONNECTED = "Not connected.";
const UNREACHABLE = "That took too long.";
const TIMEOUT_MS = 8000;

export const NEEDS_0020 =
  "This project has not run migration 0020 yet, so friends are not set up.";

const NO_FUNCTION = /does not exist|could not find|schema cache/i;
const IS_FRIENDS = /friendships|find_member|my_friends/i;

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

async function capped<T>(work: PromiseLike<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Turns a Postgres complaint into something worth reading. */
function explain(message: string): string {
  if (IS_FRIENDS.test(message) && NO_FUNCTION.test(message)) return NEEDS_0020;
  if (/friendships_pair|duplicate key/i.test(message)) {
    return "You two are already connected.";
  }
  if (/friendships_no_self/i.test(message)) return "That is you.";
  return message;
}

/**
 * A guard before either id goes into a PostgREST `.or()` filter.
 *
 * That filter is a string expression, not a bound parameter, so anything
 * interpolated into it is grammar rather than data. Both ids here come from
 * our own rows and should always be uuids - which is exactly the assumption
 * worth checking rather than trusting.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strips the @ people paste, so both forms work. */
export const bareHandle = (raw: string) => raw.trim().replace(/^@+/, "").trim();

export async function findMember(
  handle: string,
): Promise<{ member?: FoundMember; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const wanted = bareHandle(handle);
  if (!wanted) return { error: "Type a handle." };

  const res = await capped(supabase.rpc("find_member", { p_handle: wanted }));
  if (!res) return { error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { error: explain(error.message) };

  const row = (data as FoundMember[] | null)?.[0] as
    | { id: string; handle: string; avatar_path: string | null }
    | undefined;
  if (!row) return { error: `Nobody here goes by @${wanted}.` };

  return {
    member: { id: row.id, handle: row.handle, avatarPath: row.avatar_path },
  };
}

export async function listFriends(): Promise<{
  rows: Friend[];
  error?: string;
}> {
  const supabase = safeClient();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const res = await capped(supabase.rpc("my_friends"));
  if (!res) return { rows: [], error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { rows: [], error: explain(error.message) };

  const rows = (data ?? []) as {
    user_id: string;
    handle: string;
    avatar_path: string | null;
    status: Friend["status"];
    direction: Friend["direction"];
    created_at: string;
  }[];

  return {
    rows: rows.map((r) => ({
      userId: r.user_id,
      handle: r.handle,
      avatarPath: r.avatar_path,
      status: r.status,
      direction: r.direction,
      createdAt: r.created_at,
    })),
  };
}

export async function sendRequest(
  addresseeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const session = await capped(supabase.auth.getSession());
  const me = session?.data.session?.user.id;
  if (!me) return { ok: false, error: "Sign in first." };

  const res = await capped(
    supabase
      .from("friendships")
      .insert({ requester_id: me, addressee_id: addresseeId, status: "pending" }),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { error } = res;
  return error ? { ok: false, error: explain(error.message) } : { ok: true };
}

/**
 * Accept one.
 *
 * Matched on the pair rather than on a row id, because the policy in 0020 only
 * lets the addressee move a row to accepted - so this can only ever succeed on
 * a request actually addressed to the caller.
 */
export async function acceptRequest(
  requesterId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const session = await capped(supabase.auth.getSession());
  const me = session?.data.session?.user.id;
  if (!me) return { ok: false, error: "Sign in first." };

  const res = await capped(
    supabase
      .from("friendships")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("requester_id", requesterId)
      .eq("addressee_id", me)
      .select("requester_id"),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { ok: false, error: explain(error.message) };
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: "That request is gone." };
  }
  return { ok: true };
}

/** Declining, unfriending and cancelling a sent request are all this. */
export async function removeFriend(
  otherId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const session = await capped(supabase.auth.getSession());
  const me = session?.data.session?.user.id;
  if (!me) return { ok: false, error: "Sign in first." };

  if (!UUID.test(me) || !UUID.test(otherId)) {
    return { ok: false, error: "That does not look like an account." };
  }

  // Either row shape, since the pair can have been created from either side.
  const res = await capped(
    supabase
      .from("friendships")
      .delete()
      .or(
        `and(requester_id.eq.${me},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${me})`,
      )
      .select("requester_id"),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { ok: false, error: explain(error.message) };
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: "Nothing to remove." };
  }
  return { ok: true };
}
