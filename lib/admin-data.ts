"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

/**
 * Reads and writes behind the admin dashboard.
 *
 * Every function returns rather than throws. The dashboard is opened on a
 * phone at a door, usually in a hurry, and the difference between "nobody has
 * signed up yet" and "the database is not answering" has to survive all the
 * way to the screen - an exception loses that distinction and takes the page
 * with it.
 *
 * Column names here have to match supabase/migrations/0001_accounts.sql and
 * 0002_admin_events_verification.sql exactly; PostgREST reports a typo as a
 * runtime error, not a build one. Rows come back snake_case and are mapped to
 * camelCase at the edge so nothing above this file has to know that.
 *
 * None of these functions is a permission check. Row-level security decides
 * what comes back, and a non-admin simply sees empty lists and writes that
 * change nothing - which is why the writes below check that a row actually
 * moved rather than trusting a quiet response.
 */

export type AccountRow = {
  id: string;
  name: string;
  /** What they asked to be called. Null until they set one, or before 0006. */
  nickname: string | null;
  email: string;
  instagram: string | null;
  phone: string | null;
  verified: boolean;
  /** Year only. A full date of birth is never stored - see 0002. */
  birthYear: number | null;
  /** Path in the public avatars bucket, or null. */
  avatarPath: string | null;
  createdAt: string;
};

export type VerificationMethod = "barcode" | "document";
export type VerificationStatus = "pending" | "approved" | "rejected";

export type VerificationRow = {
  id: string;
  userId: string;
  method: VerificationMethod;
  status: VerificationStatus;
  birthYear: number | null;
  /** Path in the private id-documents bucket. Null for barcode scans. */
  documentPath: string | null;
  documentKind: string | null;
  note: string | null;
  createdAt: string;
  /** Absent when the roster lookup failed; the row itself is still usable. */
  profile?: { name: string; email: string };
};

export type EventRow = {
  slug: string;
  title: string;
  date: string;
  time: string;
  dow: string;
  venue: string;
  flyerUrl: string | null;
  blurb: string | null;
  published: boolean;
  createdAt: string;
};

const NOT_CONNECTED = "Not connected";
const UNREACHABLE = "The database did not answer";
const NO_ROW =
  "Nothing changed - the row is gone, or this account is not an admin";

/** How long any one query gets before the dashboard stops waiting on it. */
const TIMEOUT_MS = 8000;

const ID_BUCKET = "id-documents";

/**
 * Signed link lifetime.
 *
 * A minute is long enough to open a photo of somebody's ID and short enough
 * that the same link, left in a history or pasted into a chat, is already dead
 * by the time anyone else follows it. The bucket is private for the same
 * reason; the signed URL is the only way in and should not outlive the look.
 */
const SIGNED_URL_SECONDS = 60;

const ACCOUNT_COLUMNS =
  "id,name,email,instagram,phone,verified,birth_year,created_at";
/** With the two columns 0006 adds. Fallen back from when they are not there. */
const ACCOUNT_COLUMNS_FULL = `${ACCOUNT_COLUMNS},nickname,avatar_path`;

function isMissingProfileColumn(message: string) {
  return (
    /nickname|avatar_path/i.test(message) &&
    /does not exist|could not find/i.test(message)
  );
}
const VERIFICATION_COLUMNS =
  "id,user_id,method,status,birth_year,document_path,document_kind,note,created_at";
const EVENT_COLUMNS =
  "slug,title,date,time,dow,venue,flyer_url,blurb,published,created_at";

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs one query with a ceiling on how long it may take.
 *
 * A request to a host that has gone away does not fail - it waits on the
 * browser's own timeout, minutes later. Anything that reaches the user here is
 * a sentence, never a rejected promise.
 */
async function attempt<T>(work: PromiseLike<T>): Promise<Attempt<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work).then((value) => ({ ok: true as const, value })),
      new Promise<Attempt<T>>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: UNREACHABLE }),
          TIMEOUT_MS,
        );
      }),
    ]);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : UNREACHABLE,
    };
  } finally {
    clearTimeout(timer);
  }
}

type ProfileRecord = {
  id: string;
  name: string;
  email: string;
  instagram: string | null;
  phone: string | null;
  verified: boolean;
  birth_year: number | null;
  created_at: string;
  nickname?: string | null;
  avatar_path?: string | null;
};

type NamedProfile = Pick<ProfileRecord, "id" | "name" | "email">;

type VerificationRecord = {
  id: string;
  user_id: string;
  method: VerificationMethod;
  status: VerificationStatus;
  birth_year: number | null;
  document_path: string | null;
  document_kind: string | null;
  note: string | null;
  created_at: string;
};

type EventRecord = {
  slug: string;
  title: string;
  date: string;
  time: string;
  dow: string;
  venue: string;
  flyer_url: string | null;
  blurb: string | null;
  published: boolean;
  created_at: string;
};

const toAccount = (r: ProfileRecord): AccountRow => ({
  id: r.id,
  name: r.name,
  nickname: r.nickname ?? null,
  email: r.email,
  instagram: r.instagram,
  phone: r.phone,
  verified: r.verified,
  birthYear: r.birth_year,
  avatarPath: r.avatar_path ?? null,
  createdAt: r.created_at,
});

const toVerification = (r: VerificationRecord): VerificationRow => ({
  id: r.id,
  userId: r.user_id,
  method: r.method,
  status: r.status,
  birthYear: r.birth_year,
  documentPath: r.document_path,
  documentKind: r.document_kind,
  note: r.note,
  createdAt: r.created_at,
});

const toEvent = (r: EventRecord): EventRow => ({
  slug: r.slug,
  title: r.title,
  date: r.date,
  time: r.time,
  dow: r.dow,
  venue: r.venue,
  flyerUrl: r.flyer_url,
  blurb: r.blurb,
  published: r.published,
  createdAt: r.created_at,
});

/** The signed in reviewer, for the reviewed_by stamp. Null rather than a throw. */
async function currentUserId(supabase: SupabaseClient) {
  const res = await attempt(supabase.auth.getSession());
  if (!res.ok) return null;
  return res.value.data.session?.user.id ?? null;
}

export async function listAccounts(): Promise<{
  rows: AccountRow[];
  error?: string;
}> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  // Newest first: the reason to open the roster is almost always somebody
  // who signed up in the last hour.
  const read = (columns: string) =>
    attempt(
      supabase
        .from("profiles")
        .select(columns)
        .order("created_at", { ascending: false }),
    );

  let res = await read(ACCOUNT_COLUMNS_FULL);
  if (!res.ok) return { rows: [], error: res.error };
  let { data, error } = res.value;

  if (error && isMissingProfileColumn(error.message)) {
    res = await read(ACCOUNT_COLUMNS);
    if (!res.ok) return { rows: [], error: res.error };
    ({ data, error } = res.value);
  }

  if (error) return { rows: [], error: error.message };
  return { rows: ((data ?? []) as unknown as ProfileRecord[]).map(toAccount) };
}

/**
 * Every check one guest has ever filed, newest first, for their row on the
 * roster. No profile join: the roster row is already the profile.
 */
export async function listVerificationsForUser(
  userId: string,
): Promise<{ rows: VerificationRow[]; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const res = await attempt(
    supabase
      .from("verifications")
      .select(VERIFICATION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  );
  if (!res.ok) return { rows: [], error: res.error };

  const { data, error } = res.value;
  if (error) return { rows: [], error: error.message };
  return { rows: ((data ?? []) as VerificationRecord[]).map(toVerification) };
}

export async function listVerifications(
  status?: VerificationStatus,
): Promise<{ rows: VerificationRow[]; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const all = supabase.from("verifications").select(VERIFICATION_COLUMNS);
  const res = await attempt(
    (status ? all.eq("status", status) : all)
      // Oldest first. This is a queue, and whoever has been waiting longest to
      // get through a door belongs at the top of it.
      .order("created_at", { ascending: true }),
  );
  if (!res.ok) return { rows: [], error: res.error };

  const { data, error } = res.value;
  if (error) return { rows: [], error: error.message };

  const rows = ((data ?? []) as VerificationRecord[]).map(toVerification);
  return { rows: await withProfiles(supabase, rows) };
}

/**
 * Attaches the name and email behind each user id.
 *
 * Two queries rather than one embedded select: verifications.user_id and
 * profiles.id both point at auth.users and neither points at the other, so
 * PostgREST has no foreign key to walk between them and rejects
 * `profiles(name,email)` outright.
 *
 * A failure here is not a failure of the queue. The rows still say who is
 * waiting, by id, and a missing display name is not worth throwing a review
 * list away over.
 */
async function withProfiles(supabase: SupabaseClient, rows: VerificationRow[]) {
  const ids = [...new Set(rows.map((r) => r.userId))];
  if (ids.length === 0) return rows;

  const res = await attempt(
    supabase.from("profiles").select("id,name,email").in("id", ids),
  );
  if (!res.ok) return rows;

  const { data, error } = res.value;
  if (error) return rows;

  const byId = new Map(
    ((data ?? []) as NamedProfile[]).map((p) => [
      p.id,
      { name: p.name, email: p.email },
    ]),
  );
  return rows.map((r) => {
    const profile = byId.get(r.userId);
    return profile ? { ...r, profile } : r;
  });
}

export async function reviewVerification(
  id: string,
  status: "approved" | "rejected",
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const patch: Record<string, unknown> = {
    status,
    reviewed_by: await currentUserId(supabase),
    reviewed_at: new Date().toISOString(),
  };
  // Omitted rather than nulled when the caller passes nothing: approving
  // without typing anything should not wipe what the last reviewer wrote.
  if (note !== undefined) patch.note = note.trim() || null;

  // profiles.verified is not touched here. The trigger in 0002 flips it, so
  // the two can never be set to disagree with each other.
  const res = await attempt(
    supabase.from("verifications").update(patch).eq("id", id).select("id"),
  );
  if (!res.ok) return { ok: false, error: res.error };

  const { data, error } = res.value;
  if (error) return { ok: false, error: error.message };
  // An update matching no row is exactly what RLS hands back to somebody who
  // is not an admin: no error, nothing written. Left unchecked that reads as
  // success, and the queue would appear to clear itself.
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: NO_ROW };
  }
  return { ok: true };
}

export async function listEvents(opts?: {
  publishedOnly?: boolean;
}): Promise<{ rows: EventRow[]; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const all = supabase.from("events").select(EVENT_COLUMNS);
  const res = await attempt(
    (opts?.publishedOnly ? all.eq("published", true) : all)
      // Latest date first, so the archive sinks to the bottom of the list.
      .order("date", { ascending: false }),
  );
  if (!res.ok) return { rows: [], error: res.error };

  const { data, error } = res.value;
  if (error) return { rows: [], error: error.message };
  return { rows: ((data ?? []) as EventRecord[]).map(toEvent) };
}

export async function upsertEvent(
  e: Partial<EventRow> & { slug: string; title: string; date: string },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const row: Record<string, unknown> = {
    slug: e.slug,
    title: e.title,
    date: e.date,
    // Nothing in the database maintains this, so the client has to. Without
    // it an edited event keeps claiming the moment it was first written.
    updated_at: new Date().toISOString(),
  };
  // Fields the caller left out stay out of the payload entirely: on an insert
  // the column defaults from 0002 apply, and on a conflict the stored value
  // survives instead of being blanked.
  if (e.time !== undefined) row.time = e.time;
  if (e.dow !== undefined) row.dow = e.dow;
  if (e.venue !== undefined) row.venue = e.venue;
  if (e.flyerUrl !== undefined) row.flyer_url = e.flyerUrl;
  if (e.blurb !== undefined) row.blurb = e.blurb;
  if (e.published !== undefined) row.published = e.published;

  // created_by is left alone. An upsert cannot tell an insert from an update,
  // and stamping the current admin on every save would quietly turn "who made
  // this" into "who touched it last".
  const res = await attempt(
    supabase.from("events").upsert(row, { onConflict: "slug" }).select("slug"),
  );
  if (!res.ok) return { ok: false, error: res.error };

  const { data, error } = res.value;
  if (error) return { ok: false, error: error.message };
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: NO_ROW };
  }
  return { ok: true };
}

export async function deleteEvent(
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await attempt(
    supabase.from("events").delete().eq("slug", slug).select("slug"),
  );
  if (!res.ok) return { ok: false, error: res.error };

  const { data, error } = res.value;
  if (error) return { ok: false, error: error.message };
  // Same silence as an update: a delete a policy refuses removes nothing and
  // says nothing about it.
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: NO_ROW };
  }
  return { ok: true };
}

/**
 * A short-lived link to one uploaded ID document.
 *
 * Null covers every way this can fail - no client, no permission, no such
 * file - because the caller can do exactly one thing about any of them, which
 * is to not show the photo.
 */
export async function signedDocumentUrl(path: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const res = await attempt(
    supabase.storage.from(ID_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS),
  );
  if (!res.ok) return null;

  const { data, error } = res.value;
  return error ? null : (data?.signedUrl ?? null);
}

// -------------------------------------------------------------- all orders --

export type AdminOrderLine = {
  tierId: string;
  tierName: string;
  qty: number;
  unitCents: number;
  admits: number;
  donation: boolean;
};

export type AdminOrderRow = {
  id: string;
  eventSlug: string;
  eventTitle: string;
  promoCode: string | null;
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
  totalCents: number;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  createdAt: string;
  cancelledAt: string | null;
  lines: AdminOrderLine[];
  /** Passes this order issued in total - 0 for a donation-only order. */
  passCount: number;
  /** Of those, how many a door has already scanned in. */
  checkedIn: number;
  /** Every pass on the order, so one can be revoked without the rest. */
  passes: AdminPass[];
};

export type AdminPass = {
  code: string;
  tierName: string;
  admits: number;
  usedAt: string | null;
  revokedAt: string | null;
};

const ORDER_HEAD =
  "id, event_slug, event_title, promo_code, subtotal_cents, discount_cents, fee_cents, total_cents, buyer_name, buyer_email, buyer_phone, created_at, cancelled_at";

const ADMIN_ORDER_COLUMNS = `${ORDER_HEAD}, order_lines(tier_id, tier_name, qty, unit_cents, admits, donation), passes(code, tier_name, admits, used_at, revoked_at)`;

/**
 * The same query for a database where 0004 has not been run yet.
 *
 * order_lines.donation is the only thing that migration adds, and without it
 * PostgREST rejects the whole select rather than returning the columns it does
 * have - so one unrun migration takes down the entire dashboard rather than
 * costing it a single distinction. Falling back means a promoter still sees
 * every number; donations just look like ordinary lines until 0004 is applied.
 */
const ADMIN_ORDER_COLUMNS_PRE_0004 = `${ORDER_HEAD}, order_lines(tier_id, tier_name, qty, unit_cents, admits), passes(code, tier_name, admits, used_at, revoked_at)`;

/** PostgREST's wording for a column the schema does not have. */
function isMissingDonationColumn(message: string) {
  return (
    /donation|revoked_at|revoked_by/i.test(message) &&
    /does not exist|could not find/i.test(message)
  );
}

/** The same query for a database that has run neither 0004 nor 0008. */
const ADMIN_ORDER_COLUMNS_MINIMAL = `${ORDER_HEAD}, order_lines(tier_id, tier_name, qty, unit_cents, admits), passes(code, tier_name, admits, used_at)`;

type AdminOrderRecord = {
  id: string;
  event_slug: string;
  event_title: string;
  promo_code: string | null;
  subtotal_cents: number;
  discount_cents: number;
  fee_cents: number;
  total_cents: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  created_at: string;
  cancelled_at: string | null;
  order_lines: {
    tier_id: string;
    tier_name: string;
    qty: number;
    unit_cents: number;
    admits: number;
    donation: boolean;
  }[];
  passes: {
    code: string;
    tier_name: string;
    admits: number;
    used_at: string | null;
    revoked_at?: string | null;
  }[];
};

function toAdminOrder(r: AdminOrderRecord): AdminOrderRow {
  const passes = r.passes ?? [];
  return {
    id: r.id,
    eventSlug: r.event_slug,
    eventTitle: r.event_title,
    promoCode: r.promo_code,
    subtotalCents: r.subtotal_cents,
    discountCents: r.discount_cents,
    feeCents: r.fee_cents,
    totalCents: r.total_cents,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    buyerPhone: r.buyer_phone,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    lines: (r.order_lines ?? []).map((l) => ({
      tierId: l.tier_id,
      tierName: l.tier_name,
      qty: l.qty,
      unitCents: l.unit_cents,
      admits: l.admits,
      donation: l.donation,
    })),
    passCount: passes.length,
    checkedIn: passes.filter((p) => p.used_at !== null).length,
    passes: passes.map((p) => ({
      code: p.code,
      tierName: p.tier_name,
      admits: p.admits,
      usedAt: p.used_at,
      revokedAt: p.revoked_at ?? null,
    })),
  };
}

/**
 * Every order across every guest - the roster and the revenue behind it.
 *
 * Not filtered to the caller's own rows, unlike listOrders in orders-data.ts:
 * this is only ever reached from a screen already gated on auth.isAdmin, and
 * "read own orders" in 0001_accounts.sql grants exactly this -
 * auth.uid() = user_id OR public.is_admin() - to that same session. A
 * non-admin calling this gets nothing back, because the policy hides the rows
 * rather than this function choosing not to ask for them.
 *
 * Cancelled orders are included rather than filtered out here, unlike the
 * guest-facing version - a dashboard totalling money needs to be able to show
 * that a cancellation happened, not just quietly stop counting it.
 */
export async function listAllOrders(): Promise<{
  rows: AdminOrderRow[];
  error?: string;
}> {
  const supabase = getSupabase();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const read = (columns: string) =>
    attempt(
      supabase
        .from("orders")
        .select(columns)
        .order("created_at", { ascending: false }),
    );

  let res = await read(ADMIN_ORDER_COLUMNS);
  if (!res.ok) return { rows: [], error: res.error };

  let { data, error } = res.value;

  if (error && isMissingDonationColumn(error.message)) {
    res = await read(ADMIN_ORDER_COLUMNS_PRE_0004);
    if (!res.ok) return { rows: [], error: res.error };
    ({ data, error } = res.value);
  }
  if (error && isMissingDonationColumn(error.message)) {
    res = await read(ADMIN_ORDER_COLUMNS_MINIMAL);
    if (!res.ok) return { rows: [], error: res.error };
    ({ data, error } = res.value);
  }

  if (error) return { rows: [], error: error.message };

  // donation is absent entirely on the fallback path rather than false, so it
  // is defaulted at the edge instead of trusting the row to carry it.
  // Cast through unknown: select() with a runtime string loses PostgREST's
  // inferred row type, so it comes back as its error shape instead.
  const rows = ((data ?? []) as unknown as AdminOrderRecord[]).map((r) =>
    toAdminOrder({
      ...r,
      order_lines: (r.order_lines ?? []).map((l) => ({ ...l, donation: l.donation ?? false })),
    }),
  );
  return { rows };
}


// ------------------------------------------------------------------ revoke --

/**
 * Cancels a whole order: every pass on it stops admitting anyone.
 *
 * Soft, like a guest's own cancel - cancelled_at rather than a delete - so the
 * dashboard can still show that it happened and how much it was for. Needs
 * "admins cancel any order" from 0008; without it the update matches nothing
 * and the answer says so rather than reporting a revoke that did not take.
 */
export async function revokeOrder(
  orderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await attempt(
    supabase
      .from("orders")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("cancelled_at", null)
      .select("id"),
  );
  if (!res.ok) return { ok: false, error: res.error };

  const { data, error } = res.value;
  if (error) return { ok: false, error: error.message };
  if (((data ?? []) as unknown[]).length === 0) {
    return {
      ok: false,
      error: "Nothing changed - already cancelled, or this project has not run 0008.",
    };
  }
  return { ok: true };
}

/**
 * Voids one pass and leaves the rest of its order standing.
 *
 * Distinct from used_at, which means the opposite - scanned in. Needs the
 * revoked_at column from 0008.
 */
export async function revokePass(
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const who = await currentUserId(supabase);

  const res = await attempt(
    supabase
      .from("passes")
      .update({ revoked_at: new Date().toISOString(), revoked_by: who })
      .eq("code", code)
      .is("revoked_at", null)
      .select("code"),
  );
  if (!res.ok) return { ok: false, error: res.error };

  const { data, error } = res.value;
  if (error) {
    if (/revoked_at|revoked_by/i.test(error.message)) {
      return {
        ok: false,
        error: "This project has not run migration 0008, so a single pass cannot be revoked yet.",
      };
    }
    return { ok: false, error: error.message };
  }
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: "Nothing changed - already revoked, or not an admin." };
  }
  return { ok: true };
}

/** Puts a revoked pass back. The mirror of revokePass, for a mis-tap. */
export async function restorePass(
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await attempt(
    supabase
      .from("passes")
      .update({ revoked_at: null, revoked_by: null })
      .eq("code", code)
      .not("revoked_at", "is", null)
      .select("code"),
  );
  if (!res.ok) return { ok: false, error: res.error };

  const { data, error } = res.value;
  if (error) return { ok: false, error: error.message };
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: "Nothing changed - it was not revoked." };
  }
  return { ok: true };
}
