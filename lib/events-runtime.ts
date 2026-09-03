"use client";

import { useEffect, useState } from "react";
import { listEvents, type EventRow } from "./admin-data";
import { allEvents, findEvent, type Event } from "./events";
import { isPastEvent } from "./tickets";

/**
 * The public date list, with anything published from the dashboard folded in.
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
 * always draws the static list, which is what the HTML already contains.
 */

export type RuntimeEventList = {
  /** True once the database has answered, including the answer that it cannot. */
  ready: boolean;
  events: Event[];
  error: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const UNREACHABLE = "The database did not answer";

const STATIC_SLUGS = new Set(allEvents.map((e) => e.slug));

/**
 * Day of the week for an ISO date, in the fixed three letters the cards print.
 *
 * The events table defaults `dow` to an empty string, so a row written without
 * one still has to render. Parsed and read back in UTC: taken as local time, a
 * date west of Greenwich lands on the previous evening and every flyer in that
 * timezone gets stamped with the wrong day.
 */
function dowOf(iso: string) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? "" : DOW[new Date(ms).getUTCDay()];
}

const POSH_ORIGINAL = /images\.posh\.vip\/originals\/([A-Za-z0-9_-]+)/;

/**
 * The Posh image id inside a stored flyer link.
 *
 * `Event.imageId` is an id rather than a URL - components/Flyer.tsx builds the
 * CDN link and the whole srcSet from it - so a flyer hosted anywhere else
 * cannot survive the crossing and the card falls back to its no-flyer state.
 * Every flyer this crew makes is already on Posh, which is where the dashboard
 * is copying from.
 */
function poshImageId(flyerUrl: string | null): string | undefined {
  const raw = flyerUrl?.trim();
  if (!raw) return undefined;

  const found = POSH_ORIGINAL.exec(raw);
  if (found) return found[1];
  // Someone who pasted the id on its own rather than the whole link.
  return /^[A-Za-z0-9_-]{16,}$/.test(raw) ? raw : undefined;
}

/**
 * One row as the rest of the site expects an event to look.
 *
 * `base` is the built-in event of the same slug, when there is one. The row
 * wins every column it carries, since it was edited more recently than the
 * bundle was built. The fields the events table has no column for - price,
 * headcount, city, closing time - are kept from the static entry rather than
 * blanked: fixing a typo in a blurb should not strip an event of its price.
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

  return {
    ...base,
    slug,
    title,
    date,
    dow: row.dow?.trim() || base?.dow || dowOf(date),
    time: row.time?.trim() || base?.time || "9:00 PM",
    venue: row.venue?.trim() || base?.venue || "Location TBA",
    ...(imageId ? { imageId } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * The order lib/events.ts lays its two lists out in by hand: what is coming
 * next first and soonest first, then the archive with the most recent night at
 * the top. Sorting rather than concatenating means a runtime date drops into
 * the right place in the run instead of onto the end of it.
 */
function bySiteOrder(a: Event, b: Event) {
  const aPast = isPastEvent(a);
  if (aPast !== isPastEvent(b)) return aPast ? 1 : -1;
  return aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
}

function merge(rows: EventRow[]): Event[] {
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
  return merged.sort(bySiteOrder);
}

export function useRuntimeEvents(): RuntimeEventList {
  // Seeded with the full static list rather than an empty one, so the first
  // render is the finished listing and nothing further down can flash a "no
  // dates" state while the query is in flight.
  const [state, setState] = useState<RuntimeEventList>({
    ready: false,
    events: allEvents,
    error: null,
  });

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

      setState({
        ready: true,
        events: result.rows.length > 0 ? merge(result.rows) : allEvents,
        error: result.error ?? null,
      });
    })();

    return () => {
      live = false;
    };
  }, []);

  return state;
}
