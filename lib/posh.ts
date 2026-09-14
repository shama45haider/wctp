/**
 * Plain helpers for turning a stored events-table row into what the site draws.
 *
 * No "use client" and no React, so both the browser merge in
 * lib/events-runtime.ts and the build-time metadata in lib/share-events.ts
 * can use them and read a row the same way.
 */

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * Day of the week for an ISO date, in the fixed three letters the cards print.
 *
 * The events table defaults `dow` to an empty string, so a row written without
 * one still has to render. Parsed and read back in UTC: taken as local time, a
 * date west of Greenwich lands on the previous evening and every flyer in that
 * timezone gets stamped with the wrong day.
 */
export function dowOf(iso: string) {
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
export function poshImageId(flyerUrl: string | null | undefined): string | undefined {
  const raw = flyerUrl?.trim();
  if (!raw) return undefined;

  const found = POSH_ORIGINAL.exec(raw);
  if (found) return found[1];
  // Someone who pasted the id on its own rather than the whole link.
  return /^[A-Za-z0-9_-]{16,}$/.test(raw) ? raw : undefined;
}
