import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { allEvents, dayOf, findEvent, monthOf, org, TODAY, type Event } from "./events";
import { isPastEvent } from "./tickets";
import { dowOf, poshImageId } from "./posh";

/**
 * The event list as link previews should see it, computed at build time.
 *
 * Crawlers that build a link preview (Instagram, iMessage, Slack...) run no
 * JavaScript, so the browser-side merge in lib/events-runtime.ts never reaches
 * them. This does the same merge on the server instead: the events built into
 * lib/events.ts plus whatever the dashboard had published when the build ran,
 * which scripts/fetch-events.mjs writes to data/events.json. That file is
 * gitignored and absent outside CI, in which case only the built-in list is
 * used.
 */

/** One row of data/events.json - `public.events` columns, snake_case. */
type EventsFileRow = {
  slug?: string | null;
  title?: string | null;
  date?: string | null;
  time?: string | null;
  dow?: string | null;
  flyer_url?: string | null;
  blurb?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readRows(): EventsFileRow[] {
  const file = path.join(process.cwd(), "data", "events.json");
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? (raw as EventsFileRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Mirrors toEvent() in lib/events-runtime.ts: the row wins every column it
 * carries, fields the table has no column for (price, headcount, closing time)
 * are kept from the built-in entry, and a row with no title or date is dropped.
 */
function toEvent(row: EventsFileRow, base?: Event): Event | null {
  const slug = row.slug?.trim();
  const title = row.title?.trim();
  const date = row.date?.slice(0, 10) ?? "";
  if (!slug || !title || !ISO_DATE.test(date)) return null;

  const imageId = poshImageId(row.flyer_url) ?? base?.imageId;
  const note = row.blurb?.trim() || base?.note;

  return {
    ...base,
    slug,
    title,
    date,
    dow: row.dow?.trim() || base?.dow || dowOf(date),
    time: row.time?.trim() || base?.time || "9:00 PM",
    ...(imageId ? { imageId } : {}),
    ...(note ? { note } : {}),
  };
}

/** Every known event: built-in entries, replaced in place by a published row of the same slug, then dashboard-only rows. */
export function eventsForSharing(): Event[] {
  const fromDb = new Map<string, Event>();
  for (const row of readRows()) {
    const event = toEvent(row, row.slug ? findEvent(row.slug.trim()) : undefined);
    if (event) fromDb.set(event.slug, event);
  }

  const merged: Event[] = allEvents.map((e) => fromDb.get(e.slug) ?? e);
  const staticSlugs = new Set(allEvents.map((e) => e.slug));
  for (const event of fromDb.values()) {
    if (!staticSlugs.has(event.slug)) merged.push(event);
  }
  return merged;
}

/** One event by slug, with any published dashboard edit applied. */
export function findEventForSharing(slug: string): Event | undefined {
  return eventsForSharing().find((e) => e.slug === slug);
}

/** The soonest event that has not happened yet as of the build day, if any. */
export function nextEventForSharing(): Event | undefined {
  return eventsForSharing()
    .filter((e) => !isPastEvent(e, TODAY))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

/**
 * A flyer sized for a link preview. Explicitly JPEG: the site's own flyer URLs
 * use format=auto, which can hand back AVIF/WebP, and preview crawlers are not
 * guaranteed to accept either.
 */
export function shareImageUrl(imageId: string): string {
  return `https://posh.vip/cdn-cgi/image/width=1200,quality=80,fit=scale-down,format=jpeg/https://images.posh.vip/originals/${imageId}`;
}

/** "Next up: TITLE — FRI 02 OCT, 6:00 PM. RSVP and the address lands in your inbox." */
export function nextUpDescription(e: Event): string {
  return `Next up: ${e.title} — ${e.dow} ${dayOf(e.date)} ${monthOf(e.date)}, ${e.time}. RSVP and the address lands in your inbox.`;
}

/**
 * openGraph + twitter for a page previewed with one event's flyer.
 *
 * Page-level openGraph replaces the root layout's wholesale rather than
 * merging with it, so the site-wide fields are repeated here. An event with no
 * flyer falls back to the app icon and a small card.
 */
export function eventShareMetadata(opts: {
  event: Event;
  url: string;
  title: string;
  description: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const { event, url, title, description } = opts;
  const image = event.imageId
    ? { url: shareImageUrl(event.imageId), alt: `${event.title} flyer` }
    : null;

  return {
    openGraph: {
      type: "website",
      siteName: org.name,
      url,
      title,
      description,
      images: image ? [image] : [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
    },
    twitter: image
      ? { card: "summary_large_image", title, description, images: [image] }
      : { card: "summary", title, description },
  };
}
