"use client";

import { useEffect, useMemo, useState } from "react";
import { listEvents, type EventRow } from "./admin-data";
import { allEvents, findEvent, type Event } from "./events";
import { isPastEvent } from "./tickets";
import { useNow } from "./now";
import { dowOf, poshImageId } from "./posh";

/**
 * The public date list, with anything published from the dashboard folded in
 * and everything sorted against the real clock rather than the frozen
 * build-time date.
 *
 * lib/events.ts is compiled into the bundle and ships with the page; the events
 * table is read in the browser afterwards. So this starts from the built-in
 * list and only ever adds to it. The static list is the floor, not the ceiling.
 *
 * That is the whole point of the fallback below. No client, a paused project, a
 * rotated key, a request that never lands - all of them return the full static
 * list with `ready` true and `error` set. A listing that empties itself on a bad
 * night is worse than one that is merely out of date, and someone reading the
 * site has no idea a database exists to be down.
 *
 * Everything is client-side by necessity: this is a static export, so there is
 * no server render of these rows and nothing to hydrate against. The first pass
 * always draws the static list ordered against the build-time TODAY, which is
 * what the HTML already contains - see useNow() for why that is safe. `now`
 * ticking over to the visitor's real date afterwards is what moves a date that
 * has passed into `past` and promotes whichever is genuinely soonest into
 * `upcoming[0]`, with no redeploy in between.
 */

export type RuntimeEventList = {
  /** True once the database has answered, including the answer that it cannot. */
  ready: boolean;
  /** Every known event, upcoming first (soonest first), then past (most recent first). */
  events: Event[];
  /** The same events, already split against `now`. */
  upcoming: Event[];
  past: Event[];
  /** What this was computed against - share it rather than call useNow() again. */
  now: Date;
  /**
   * Whether the static export has a page for this slug. False for a date
   * published after the last build: app/events/[slug] has
   * `dynamicParams = false`, so a link to it would 404. List it, unlinked.
   */
  hasPage: (slug: string) => boolean;
  error: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const UNREACHABLE = "The database did not answer";

const STATIC_SLUGS = new Set(allEvents.map((e) => e.slug));

/**
 * One row as the rest of the site expects an event to look.
 *
 * `base` is the built-in event of the same slug, when there is one. The row
 * wins every column it carries, since it was edited more recently than the
 * bundle was built. The fields the events table has no column for - price,
 * headcount, closing time - are kept from the static entry rather than
 * blanked: fixing a typo in a blurb should not strip an event of its price.
 * The table's venue column is never read: the address is emailed, not shown.
 *
 * Null for a row that cannot be drawn. PostgREST hands back a renamed or
 * missing column as data, not as an error, and a card with no title and no date
 * is an empty box on the public site.
 */
function toEvent(row: EventRow, base?: Event): Event | null {
  const slug = row.slug?.trim();
  const title = row.title?.trim();
  const date = row.date?.slice(0, 10) ?? "";
  if (!slug || !title || !ISO_DATE.test(date)) return null;

  const imageId = poshImageId(row.flyerUrl) ?? base?.imageId;
  const note = row.blurb?.trim() || base?.note;
  const ticketRedirectUrl = row.ticketRedirectUrl?.trim();

  return {
    ...base,
    slug,
    title,
    date,
    dow: row.dow?.trim() || base?.dow || dowOf(date),
    time: row.time?.trim() || base?.time || "9:00 PM",
    ...(imageId ? { imageId } : {}),
    ...(note ? { note } : {}),
    ...(ticketRedirectUrl ? { ticketRedirectUrl } : {}),
  };
}

/**
 * The order lib/events.ts lays its two lists out in by hand: what is coming
 * next first and soonest first, then the archive with the most recent night at
 * the top. Sorting against `now` rather than concatenating means a runtime
 * date drops into the right place in the run instead of onto the end of it -
 * and means a date that has since passed falls out of `upcoming` on its own,
 * the same as anything else.
 */
function bySiteOrder(now: Date) {
  return (a: Event, b: Event) => {
    const aPast = isPastEvent(a, now);
    if (aPast !== isPastEvent(b, now)) return aPast ? 1 : -1;
    return aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  };
}

/**
 * Every known event - the static list with any published row folded in - in
 * site order against `now`. Always resorted here rather than only when rows
 * exist: the old shortcut of handing back the static list untouched when the
 * table was empty also meant it never got a second look once "now" moved on,
 * which is the exact bug this hook exists to close.
 */
function merge(rows: EventRow[], now: Date): Event[] {
  const fromDb = new Map<string, Event>();
  for (const row of rows) {
    const event = toEvent(row, findEvent(row.slug));
    if (event) fromDb.set(event.slug, event);
  }

  // A published row for a slug the site already ships is an edit of that event,
  // so it replaces it in place. Everything else is appended.
  const merged: Event[] = allEvents.map((e) => fromDb.get(e.slug) ?? e);
  for (const event of fromDb.values()) {
    if (!STATIC_SLUGS.has(event.slug)) merged.push(event);
  }
  return merged.sort(bySiteOrder(now));
}

/**
 * `pageSlugs` is every slug the static export built a page for, from
 * eventPageSlugs() in the server page that renders the caller. Without it only
 * the built-in events count as having one, which is always true of them.
 */
export function useRuntimeEvents(pageSlugs?: readonly string[]): RuntimeEventList {
  const now = useNow();

  const hasPage = useMemo(() => {
    const slugs = pageSlugs ? new Set(pageSlugs) : STATIC_SLUGS;
    return (slug: string) => slugs.has(slug);
  }, [pageSlugs]);

  // Null until the fetch answers, including with an error - not the same as
  // "zero rows", which is the ordinary night and still needs sorting against
  // `now` every time it comes up, not just the first.
  const [db, setDb] = useState<{ rows: EventRow[]; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      // listEvents caps itself at eight seconds and returns a sentence instead
      // of throwing, so `ready` always flips. The try is for the one thing it
      // cannot catch: a client that throws while it is being constructed.
      let result: { rows: EventRow[]; error?: string };
      try {
        // Drafts are hidden by row-level security anyway, but an admin reading
        // the public site is signed in and would otherwise see their own
        // unpublished dates listed as if they were announced.
        result = await listEvents({ publishedOnly: true });
      } catch (e) {
        result = {
          rows: [],
          error: e instanceof Error && e.message ? e.message : UNREACHABLE,
        };
      }
      if (!live) return;
      setDb({ rows: result.rows, error: result.error ?? null });
    })();

    return () => {
      live = false;
    };
  }, []);

  // Recomputed whenever the fetch answers or `now` ticks over to a new day,
  // so a date crossing "now" while the tab is open reorders the list without
  // waiting on a fresh fetch to trigger it.
  return useMemo<RuntimeEventList>(() => {
    const events = merge(db?.rows ?? [], now);
    // `events` is already upcoming-then-past by construction, so the first
    // past entry is exactly where the archive begins.
    const splitAt = events.findIndex((e) => isPastEvent(e, now));
    const upcoming = splitAt === -1 ? events : events.slice(0, splitAt);
    const past = splitAt === -1 ? [] : events.slice(splitAt);
    return {
      ready: db !== null,
      events,
      upcoming,
      past,
      now,
      hasPage,
      error: db?.error ?? null,
    };
  }, [db, now, hasPage]);
}
