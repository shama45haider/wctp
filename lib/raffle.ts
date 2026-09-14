"use client";

import { SITE_ORIGIN } from "./events";
import { getSupabase } from "./supabase";

/**
 * The members' raffle, the dashboard's controls for it, and the live draw.
 *
 * Every rule lives in supabase/migrations/0015_raffle.sql and
 * 0016_raffle_admin_live.sql: who may enter, who may draw, how long a live
 * link lasts, and who wins. Nothing here decides any of that - it reads the
 * answers and passes on the database's own refusals. Returns rather than
 * throws, like the other data modules.
 */

export type Prize = { place: string; items: string[] };

export type Raffle = {
  id: string;
  title: string;
  blurb: string | null;
  prizes: Prize[];
  /** Taking entries. Going live closes it. */
  open: boolean;
  /** On the site. The pop-up shows the newest visible raffle. */
  visible: boolean;
  createdAt: string;
};

export type RafflePatch = Partial<Pick<Raffle, "title" | "blurb" | "prizes" | "open" | "visible">>;

export type Entrant = { handle: string; enteredAt: string };

export type RaffleState = {
  /** Nothing to show: no database, migrations not run, or no visible raffle. */
  missing: boolean;
  raffle: Raffle | null;
  entrants: Entrant[];
  entered: boolean;
  error: string | null;
};

export type AdminEntrant = {
  userId: string;
  handle: string;
  email: string | null;
  firstName: string | null;
  avatarPath: string | null;
  enteredAt: string;
};

export type LiveSession = { token: string; expiresAt: string };

export type AdminDraw = { place: number; userId: string; drawnAt: string };

export type LiveEntrant = {
  /** One-way key for the entrant - the live page never sees a user id. */
  key: string;
  handle: string;
  avatarPath: string | null;
  enteredAt: string;
};

export type LiveDraw = { place: number; key: string; spinOffset: number; drawnAt: string };

export type LiveView =
  | { status: "invalid" | "expired" }
  | {
      status: "live";
      serverNow: string;
      expiresAt: string;
      raffle: { id: string; title: string; prizes: Prize[] };
      entrants: LiveEntrant[];
      draws: LiveDraw[];
    };

type Outcome = { ok: boolean; error?: string };

const TIMEOUT_MS = 8000;
const NOT_CONNECTED = "Not connected.";
const UNREACHABLE = "The database did not answer.";
const NOT_ADMIN = "Nothing saved - this account is not an admin.";
export const NEEDS_0016 =
  "The raffle isn't fully set up in the database yet - run supabase/RUN_THIS.sql in the SQL editor.";

const RAFFLE_COLUMNS = "id,title,blurb,prizes,open,visible,created_at";

const isMissingSchema = (message: string) =>
  /raffle/i.test(message) && /does not exist|could not find|schema cache/i.test(message);

const explain = (message: string) => (isMissingSchema(message) ? NEEDS_0016 : message);

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

/** Whatever came back from the jsonb column, as prizes the page can draw. */
export function toPrizes(raw: unknown): Prize[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const o = (p ?? {}) as { place?: unknown; items?: unknown };
    return {
      place: typeof o.place === "string" ? o.place : "",
      items: Array.isArray(o.items)
        ? o.items.filter((i): i is string => typeof i === "string")
        : [],
    };
  });
}

type RaffleRow = {
  id: string;
  title: string | null;
  blurb: string | null;
  prizes: unknown;
  open: boolean | null;
  visible: boolean | null;
  created_at: string;
};

const toRaffle = (r: RaffleRow): Raffle => ({
  id: r.id,
  title: r.title?.trim() || "Raffle",
  blurb: r.blurb,
  prizes: toPrizes(r.prizes),
  open: Boolean(r.open),
  visible: r.visible !== false,
  createdAt: r.created_at,
});

/* ----------------------------------------------------------------- guests -- */

export async function loadRaffle(userId: string | undefined): Promise<RaffleState> {
  const supabase = safeClient();
  if (!supabase) return { missing: true, raffle: null, entrants: [], entered: false, error: null };

  const current = await capped(
    supabase
      .from("raffles")
      .select(RAFFLE_COLUMNS)
      .eq("visible", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    TIMEOUT_MS,
  );
  if (!current) {
    return { missing: false, raffle: null, entrants: [], entered: false, error: "The raffle did not load." };
  }
  if (current.error) {
    return {
      missing: isMissingSchema(current.error.message),
      raffle: null,
      entrants: [],
      entered: false,
      error: current.error.message,
    };
  }
  if (!current.data) return { missing: true, raffle: null, entrants: [], entered: false, error: null };

  const raffle = toRaffle(current.data as unknown as RaffleRow);

  const [list, mine] = await Promise.all([
    capped(supabase.rpc("raffle_entrants", { p_raffle: raffle.id }), TIMEOUT_MS),
    userId
      ? capped(
          supabase
            .from("raffle_entries")
            .select("user_id")
            .eq("raffle_id", raffle.id)
            .eq("user_id", userId)
            .maybeSingle(),
          TIMEOUT_MS,
        )
      : Promise.resolve(null),
  ]);

  if (!list || (userId && !mine)) {
    return { missing: false, raffle, entrants: [], entered: false, error: "The entry list did not load." };
  }
  const failure = list.error ?? mine?.error;
  if (failure) {
    return { missing: false, raffle, entrants: [], entered: false, error: explain(failure.message) };
  }

  const rows = (list.data ?? []) as { handle: string; entered_at: string }[];
  return {
    missing: false,
    raffle,
    entrants: rows.map((r) => ({ handle: r.handle, enteredAt: r.entered_at })),
    entered: Boolean(mine?.data),
    error: null,
  };
}

export async function enterRaffle(raffleId: string, userId: string): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase.from("raffle_entries").insert({ raffle_id: raffleId, user_id: userId }),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: "That took too long. Try again." };
  if (res.error) {
    // Already in: a double tap, or a second device. Same outcome as success.
    if (res.error.code === "23505") return { ok: true };
    if (res.error.code === "42501" || /row-level security/i.test(res.error.message)) {
      return {
        ok: false,
        error: "Entry refused - the raffle is for verified members, and entries have to still be open.",
      };
    }
    return { ok: false, error: explain(res.error.message) };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ admin -- */

export async function listRaffles(): Promise<{ raffles: Raffle[]; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { raffles: [], error: NOT_CONNECTED };

  const res = await capped(
    supabase.from("raffles").select(RAFFLE_COLUMNS).order("created_at", { ascending: false }),
    TIMEOUT_MS,
  );
  if (!res) return { raffles: [], error: UNREACHABLE };
  if (res.error) return { raffles: [], error: explain(res.error.message) };
  return { raffles: ((res.data ?? []) as unknown as RaffleRow[]).map(toRaffle) };
}

/** A new raffle starts hidden, with three empty places to fill in. */
export async function createRaffle(title: string): Promise<{ id?: string; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const id = `raffle-${Date.now().toString(36)}`;
  const res = await capped(
    supabase
      .from("raffles")
      .insert({
        id,
        title: title.trim() || "New raffle",
        visible: false,
        open: true,
        prizes: [
          { place: "1ST PLACE", items: [] },
          { place: "2ND PLACE", items: [] },
          { place: "3RD PLACE", items: [] },
        ],
      })
      .select("id"),
    TIMEOUT_MS,
  );
  if (!res) return { error: UNREACHABLE };
  if (res.error) return { error: explain(res.error.message) };
  if ((res.data ?? []).length === 0) return { error: NOT_ADMIN };
  return { id };
}

export async function saveRaffle(id: string, patch: RafflePatch): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title.trim() || "Raffle";
  if (patch.blurb !== undefined) row.blurb = patch.blurb?.trim() || null;
  if (patch.prizes !== undefined) {
    row.prizes = patch.prizes.map((p) => ({
      place: p.place.trim(),
      items: p.items.map((i) => i.trim()).filter(Boolean),
    }));
  }
  if (patch.open !== undefined) row.open = patch.open;
  if (patch.visible !== undefined) row.visible = patch.visible;

  const res = await capped(
    supabase.from("raffles").update(row).eq("id", id).select("id"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  if ((res.data ?? []).length === 0) return { ok: false, error: NOT_ADMIN };
  return { ok: true };
}

export async function listEntries(
  raffleId: string,
): Promise<{ entries: AdminEntrant[]; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { entries: [], error: NOT_CONNECTED };

  const res = await capped(
    supabase.rpc("raffle_admin_entries", { p_raffle: raffleId }),
    TIMEOUT_MS,
  );
  if (!res) return { entries: [], error: UNREACHABLE };
  if (res.error) return { entries: [], error: explain(res.error.message) };

  type Row = {
    user_id: string;
    handle: string;
    email: string | null;
    first_name: string | null;
    avatar_path: string | null;
    entered_at: string;
  };
  return {
    entries: ((res.data ?? []) as Row[]).map((r) => ({
      userId: r.user_id,
      handle: r.handle,
      email: r.email,
      firstName: r.first_name,
      avatarPath: r.avatar_path,
      enteredAt: r.entered_at,
    })),
  };
}

export async function removeEntry(raffleId: string, userId: string): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase
      .from("raffle_entries")
      .delete()
      .eq("raffle_id", raffleId)
      .eq("user_id", userId)
      .select("user_id"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing removed - this account is not an admin." };
  }
  return { ok: true };
}

/** The live link currently running for a raffle, or null. */
export async function readLiveSession(
  raffleId: string,
): Promise<{ session: LiveSession | null; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { session: null, error: NOT_CONNECTED };

  const res = await capped(
    supabase
      .from("raffle_live_sessions")
      .select("token,expires_at")
      .eq("raffle_id", raffleId)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    TIMEOUT_MS,
  );
  if (!res) return { session: null, error: UNREACHABLE };
  if (res.error) return { session: null, error: explain(res.error.message) };
  const row = res.data as { token: string; expires_at: string } | null;
  return { session: row ? { token: row.token, expiresAt: row.expires_at } : null };
}

/** Starts a one-hour live link (and closes entries). Ends any earlier link. */
export async function goLive(raffleId: string): Promise<{ session?: LiveSession; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const res = await capped(supabase.rpc("raffle_go_live", { p_raffle: raffleId }), TIMEOUT_MS);
  if (!res) return { error: UNREACHABLE };
  if (res.error) return { error: explain(res.error.message) };
  const data = res.data as { token?: string; expires_at?: string } | null;
  if (!data?.token || !data.expires_at) return { error: "The live link didn't come back." };
  return { session: { token: data.token, expiresAt: data.expires_at } };
}

export async function endLive(raffleId: string): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(supabase.rpc("raffle_end_live", { p_raffle: raffleId }), TIMEOUT_MS);
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  return { ok: true };
}

/** The shareable address for a live token - always the real domain, like ticket QRs. */
export function liveLink(token: string): string {
  return `${SITE_ORIGIN}/raffle/live/?t=${encodeURIComponent(token)}`;
}

export async function listDraws(raffleId: string): Promise<{ draws: AdminDraw[]; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { draws: [], error: NOT_CONNECTED };

  const res = await capped(
    supabase
      .from("raffle_draws")
      .select("place,user_id,drawn_at")
      .eq("raffle_id", raffleId)
      .order("place"),
    TIMEOUT_MS,
  );
  if (!res) return { draws: [], error: UNREACHABLE };
  if (res.error) return { draws: [], error: explain(res.error.message) };
  return {
    draws: ((res.data ?? []) as { place: number; user_id: string; drawn_at: string }[]).map((d) => ({
      place: d.place,
      userId: d.user_id,
      drawnAt: d.drawn_at,
    })),
  };
}

/** Picks the winner for a place, in the database. Needs a live link open. */
export async function drawWinner(raffleId: string, place: number): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase.rpc("raffle_draw", { p_raffle: raffleId, p_place: place }),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  return { ok: true };
}

/** Clears a place's winner so it can be spun again - for a winner who isn't there. */
export async function clearDraw(raffleId: string, place: number): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase.from("raffle_draws").delete().eq("raffle_id", raffleId).eq("place", place),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: explain(res.error.message) };
  return { ok: true };
}

/* ------------------------------------------------------------------- live -- */

export async function loadLive(token: string): Promise<{ view?: LiveView; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const res = await capped(supabase.rpc("raffle_live", { p_token: token }), TIMEOUT_MS);
  if (!res) return { error: "Lost the connection. Retrying…" };
  if (res.error) return { error: explain(res.error.message) };

  const d = res.data as Record<string, unknown> | null;
  if (!d || typeof d.status !== "string") return { error: "The live draw didn't answer properly." };
  if (d.status !== "live") {
    return { view: { status: d.status === "expired" ? "expired" : "invalid" } };
  }

  const raffle = (d.raffle ?? {}) as { id?: unknown; title?: unknown; prizes?: unknown };
  type EntrantRow = { key: string; handle: string; avatar_path: string | null; entered_at: string };
  type DrawRow = { place: number; key: string; spin_offset: number | string; drawn_at: string };

  return {
    view: {
      status: "live",
      serverNow: String(d.server_now),
      expiresAt: String(d.expires_at),
      raffle: {
        id: String(raffle.id ?? ""),
        title: typeof raffle.title === "string" ? raffle.title : "Raffle",
        prizes: toPrizes(raffle.prizes),
      },
      entrants: (Array.isArray(d.entrants) ? (d.entrants as EntrantRow[]) : []).map((e) => ({
        key: e.key,
        handle: e.handle,
        avatarPath: e.avatar_path,
        enteredAt: e.entered_at,
      })),
      draws: (Array.isArray(d.draws) ? (d.draws as DrawRow[]) : []).map((x) => ({
        place: Number(x.place),
        key: x.key,
        spinOffset: Number(x.spin_offset),
        drawnAt: x.drawn_at,
      })),
    },
  };
}
