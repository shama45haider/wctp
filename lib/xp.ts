"use client";

import { getSupabase } from "./supabase";

/**
 * XP.
 *
 * Nothing here writes anything. Every number comes from member_xp() in 0021,
 * which counts the rows that already exist - there is no xp column to set and
 * no award to grant, so the only way to move a total is to do the thing.
 */

export type XpBreakdown = {
  attended: number;
  tickets: number;
  friends: number;
  requests: number;
  raffles: number;
  attendedXp: number;
  ticketsXp: number;
  friendsXp: number;
  requestsXp: number;
  rafflesXp: number;
  total: number;
};

export type BoardRow = {
  handle: string;
  avatarPath: string | null;
  total: number;
};

/** What each thing is worth. Mirrors 0021 - the database is the authority. */
export const WORTH = {
  attended: 100,
  ticket: 25,
  friend: 10,
  request: 5,
  raffle: 5,
} as const;

/** Friends stop paying here, so two alt accounts cannot farm the board. */
export const FRIEND_CAP = 20;

/**
 * The rungs.
 *
 * Wide on purpose. A ladder somebody climbs two rungs of in one night stops
 * meaning anything by the third party, and the top one should take a while.
 */
export const RANKS = [
  { at: 0, name: "New here" },
  { at: 100, name: "Been once" },
  { at: 350, name: "Regular" },
  { at: 800, name: "Head" },
  { at: 1600, name: "Veteran" },
  { at: 3000, name: "Legend" },
] as const;

export function rankOf(total: number) {
  // Widened off the const tuple: `as const` makes RANKS[0] the literal type
  // {at: 0, name: "New here"}, which nothing else in the list assigns to.
  let current: { at: number; name: string } = RANKS[0];
  for (const r of RANKS) if (total >= r.at) current = r;
  const next = RANKS.find((r) => r.at > total) ?? null;
  return {
    name: current.name,
    next: next?.name ?? null,
    toGo: next ? next.at - total : 0,
    // How far along this rung, for the bar. Full at the top rung.
    progress: next
      ? Math.min(1, Math.max(0, (total - current.at) / (next.at - current.at)))
      : 1,
  };
}

const NOT_CONNECTED = "Not connected.";
const UNREACHABLE = "That took too long.";
const TIMEOUT_MS = 8000;

export const NEEDS_0021 =
  "This project has not run migration 0021 yet, so there is no XP to count.";

const NO_FUNCTION = /does not exist|could not find|schema cache/i;
const IS_XP = /member_xp|my_xp|xp_board|show_on_leaderboard/i;

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

const explain = (m: string) =>
  IS_XP.test(m) && NO_FUNCTION.test(m) ? NEEDS_0021 : m;

export async function myXp(): Promise<{
  xp?: XpBreakdown;
  error?: string;
}> {
  const supabase = safeClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const res = await capped(supabase.rpc("my_xp"));
  if (!res) return { error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { error: explain(error.message) };

  const r = (data as Record<string, number>[] | null)?.[0];
  if (!r) return { error: "Nothing came back." };

  return {
    xp: {
      attended: r.attended ?? 0,
      tickets: r.tickets ?? 0,
      friends: r.friends ?? 0,
      requests: r.requests ?? 0,
      raffles: r.raffles ?? 0,
      attendedXp: r.attended_xp ?? 0,
      ticketsXp: r.tickets_xp ?? 0,
      friendsXp: r.friends_xp ?? 0,
      requestsXp: r.requests_xp ?? 0,
      rafflesXp: r.raffles_xp ?? 0,
      total: r.total ?? 0,
    },
  };
}

export async function xpBoard(
  limit = 25,
): Promise<{ rows: BoardRow[]; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const res = await capped(supabase.rpc("xp_board", { p_limit: limit }));
  if (!res) return { rows: [], error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { rows: [], error: explain(error.message) };

  const rows = (data ?? []) as {
    handle: string;
    avatar_path: string | null;
    total: number;
  }[];
  return {
    rows: rows.map((r) => ({
      handle: r.handle,
      avatarPath: r.avatar_path,
      total: r.total,
    })),
  };
}

/** Whether this account shows up on the public board. */
export async function setBoardVisible(
  visible: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const session = await capped(supabase.auth.getSession());
  const me = session?.data.session?.user.id;
  if (!me) return { ok: false, error: "Sign in first." };

  const res = await capped(
    supabase
      .from("profiles")
      .update({ show_on_leaderboard: visible })
      .eq("id", me)
      .select("id"),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { ok: false, error: explain(error.message) };
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: "That did not save." };
  }
  return { ok: true };
}
