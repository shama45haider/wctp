"use client";

import { getSupabase } from "./supabase";

/**
 * Song requests.
 *
 * Returns rather than throws, like the rest of the data layer - a request that
 * did not save has to say so in a sentence somebody can read, not take the
 * page down with it.
 *
 * Every rule lives in 0019: five per night per person, no duplicate track for
 * the same night, and row-level security that shows a guest only their own.
 * Nothing here is a permission check.
 */

export type SongRequest = {
  id: string;
  /** Null for "play it whenever", not for "we do not know". */
  eventSlug: string | null;
  eventTitle: string | null;
  song: string;
  artist: string | null;
  /** A YouTube URL, or null. Only ever youtube.com/youtu.be - see 0019. */
  link: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  event_slug: string | null;
  event_title: string | null;
  song: string;
  artist: string | null;
  link: string | null;
  created_at: string;
};

const COLUMNS = "id,event_slug,event_title,song,artist,link,created_at";
const NOT_CONNECTED = "Not connected.";
const UNREACHABLE = "That took too long.";
const TIMEOUT_MS = 8000;

export const NEEDS_0019 =
  "This project has not run migration 0019 yet, so there is nowhere to save a request.";

/** Matches the trigger and the unique index in 0019, so each gets its own line. */
const AT_LIMIT = /five requests for this one/i;
const DUPLICATE = /song_requests_no_dupes|duplicate key/i;
const MISSING_TABLE = /song_requests/i;
const BAD_LINK = /song_requests_link/i;
const NO_RELATION = /does not exist|could not find|schema cache/i;

/**
 * Null if this is a YouTube link we will accept, otherwise the reason.
 *
 * Mirrors the constraint in 0019 rather than replacing it - the database is
 * what actually enforces this, and a pasted link that slips past the parser
 * still gets refused there. This exists so the usual mistakes (a Spotify
 * link, a bare video id, plain http) are answered in the form instead of
 * coming back as a constraint name.
 */
export function youtubeLinkProblem(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That does not look like a link.";
  }
  if (parsed.protocol !== "https:") return "Needs to start with https://.";

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const ok = host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
  if (!ok) return "YouTube links only.";
  if (url.length > 400) return "That link is too long.";
  return null;
}

const toRequest = (r: Row): SongRequest => ({
  id: r.id,
  eventSlug: r.event_slug,
  eventTitle: r.event_title,
  song: r.song,
  artist: r.artist,
  link: r.link,
  createdAt: r.created_at,
});

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

/** `work`, or a plain sentence if it has not answered in time. */
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

/** Every request this guest has made, newest first. */
export async function listOwnRequests(): Promise<{
  rows: SongRequest[];
  error?: string;
}> {
  const supabase = safeClient();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const res = await capped(
    supabase
      .from("song_requests")
      .select(COLUMNS)
      .order("created_at", { ascending: false }),
  );
  if (!res) return { rows: [], error: UNREACHABLE };

  const { data, error } = res;
  if (error) {
    if (MISSING_TABLE.test(error.message) && NO_RELATION.test(error.message)) {
      return { rows: [], error: NEEDS_0019 };
    }
    return { rows: [], error: error.message };
  }
  return { rows: ((data ?? []) as Row[]).map(toRequest) };
}

export async function addRequest(input: {
  song: string;
  artist?: string;
  link?: string;
  eventSlug?: string | null;
  eventTitle?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const song = input.song.trim();
  const artist = input.artist?.trim();
  const link = input.link?.trim();
  if (!song) return { ok: false, error: "A track name, at least." };

  const linkProblem = link ? youtubeLinkProblem(link) : null;
  if (linkProblem) return { ok: false, error: linkProblem };

  const session = await capped(supabase.auth.getSession());
  const userId = session?.data.session?.user.id;
  if (!userId) return { ok: false, error: "Sign in to ask for something." };

  const res = await capped(
    supabase.from("song_requests").insert({
      user_id: userId,
      song,
      artist: artist || null,
      link: link || null,
      event_slug: input.eventSlug ?? null,
      event_title: input.eventTitle ?? null,
    }),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { error } = res;
  if (!error) return { ok: true };

  // Three different refusals that would otherwise all read as one raw
  // Postgres string. The cap and the duplicate are both things the guest can
  // act on, so they get said plainly.
  if (AT_LIMIT.test(error.message)) {
    return { ok: false, error: "That is five for this one already." };
  }
  if (DUPLICATE.test(error.message)) {
    return { ok: false, error: "You already asked for that one." };
  }
  if (BAD_LINK.test(error.message)) {
    return { ok: false, error: "YouTube links only." };
  }
  if (MISSING_TABLE.test(error.message) && NO_RELATION.test(error.message)) {
    return { ok: false, error: NEEDS_0019 };
  }
  return { ok: false, error: error.message };
}

export async function withdrawRequest(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase.from("song_requests").delete().eq("id", id).select("id"),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { ok: false, error: error.message };
  // A delete a policy refuses removes nothing and says nothing about it.
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: "Nothing was removed." };
  }
  return { ok: true };
}
