import { findEvent, org, TODAY, type Event } from "./events";

/**
 * Ticket inventory, pricing and order maths.
 *
 * Pure module - no React, no network. The tiers and add-ons themselves live in
 * the database (public.ticket_tiers, public.ticket_addons), which is also what
 * create-ticket-checkout prices a Stripe payment from, so the picker and the
 * charge can never disagree. lib/ticket-catalog.ts reads them into the store
 * below; everything here reads from that store synchronously, which keeps the
 * call sites as simple as they were when the tiers were hardcoded.
 *
 * Until the catalog loads - and on the server, during the static export -
 * every event has no tiers, which reads as "not on sale here".
 */

export type Tier = {
  id: string;
  name: string;
  priceCents: number;
  blurb?: string;
  capacity: number;
  sold: number;
  /** Per-order cap, the way a real ticketing system throttles bulk buys. */
  maxPerOrder: number;
  /** Heads this one ticket lets through the door. */
  admits?: number;
  /**
   * A donation, not an admission: the giver names the amount, it admits nobody
   * and it is left out of stock counts, "from" prices and the service fee.
   */
  donation?: boolean;
  /** Smallest accepted amount, in cents. Donations only. */
  minCents?: number;
};

/** Something extra bought with a ticket and picked up at the door. */
export type Addon = {
  id: string;
  name: string;
  priceCents: number;
  maxPerOrder: number;
};

/* ---------------------------------------------------------- the catalog -- */

let TIERS: Record<string, Tier[]> = {};
let ADDONS: Addon[] = [];
let catalogVersion = 0;
const catalogListeners = new Set<() => void>();

/** Replaces the catalog. Called by lib/ticket-catalog.ts once the database answers. */
export function setTicketCatalog(tiers: Record<string, Tier[]>, addons: Addon[]) {
  TIERS = tiers;
  ADDONS = addons;
  catalogVersion++;
  catalogListeners.forEach((l) => l());
}

export function subscribeTicketCatalog(listener: () => void) {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

/** 0 until the catalog has loaded once; bumps on every reload. */
export const ticketCatalogVersion = () => catalogVersion;

export const tiersFor = (slug: string): Tier[] => TIERS[slug] ?? [];

/** Add-ons on offer with any ticket sold on the site. */
export const addonsOn = (): Addon[] => ADDONS;

/**
 * Dates whose RSVP is taken on Posh instead of through this site's checkout,
 * keyed by slug the same way TIERS is. GET TICKETS on one of these goes to its
 * Posh event page, and it counts as on sale while the date is ahead even with
 * no tiers above. Posh owns its price and stock, so the site shows neither.
 */
const POSH_RSVP: Record<string, string> = {
  "wctp-swag-redo": "https://posh.vip/e/wecametooswagredo",
};

export const poshRsvpFor = (slug: string): string | null => POSH_RSVP[slug] ?? null;

/**
 * Tiers that actually get someone through a door.
 *
 * Stock counts, "from" prices and the on-sale/sold-out decision all run off
 * this rather than off `tiersFor`, so an open-ended donation cannot report a
 * million spots left or drag a listing price down to "Free".
 */
export const admissionTiers = (slug: string): Tier[] =>
  tiersFor(slug).filter((t) => !t.donation);

export const remaining = (t: Tier) => Math.max(0, t.capacity - t.sold);
export const isSoldOut = (t: Tier) => remaining(t) === 0;
export const admitsOf = (t: Pick<Tier, "admits">) => t.admits ?? 1;

/** How many of a tier one order may hold: per-order cap and stock, whichever bites. */
export const maxSelectable = (t: Tier) => Math.min(t.maxPerOrder, remaining(t));

/**
 * `now` defaults to the frozen build-time TODAY rather than the real clock,
 * so every existing call site keeps behaving exactly as it always has. A
 * caller that actually wants the true date - the home page, the ticket
 * browser, the picker - passes one from useNow() instead; that is the one
 * change that lets an event's date crossing the real "now" move it into the
 * archive without a rebuild. See lib/now.ts.
 *
 * Compared as calendar days, not instants: `new Date(e.date)` on its own
 * parses an ISO date-only string as UTC midnight, which in any timezone west
 * of UTC lands hours *before* that date even begins locally - an event dated
 * today could already read as past that same morning, or one dated tomorrow
 * as past this evening. Pulling the event's own year/month/day out of the
 * string and building a *local* midnight from them, then comparing against
 * `now`'s own local midnight, means a night stays "upcoming" for the whole
 * calendar day it happens on and only drops into the archive once the next
 * day has actually started on the visitor's own clock.
 */
export function isPastEvent(e: Event, now: Date = TODAY): boolean {
  const [year, month, day] = e.date.split("-").map(Number);
  const eventDay = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return eventDay < today;
}

export type SaleState = "on-sale" | "sold-out" | "closed";

export function saleState(e: Event, now: Date = TODAY): SaleState {
  if (isPastEvent(e, now)) return "closed";
  const tiers = admissionTiers(e.slug);
  // Neither a Posh RSVP nor a date sold off-site has tiers here, and both stay
  // open until the night. Without the second of those, every event posted from
  // the dashboard with a ticket link read as "closed" - which is exactly the
  // shape of event that has no tiers, because not selling here is the whole
  // reason it carries a link somewhere else. The listing called it SALES
  // CLOSED and the picker offered nothing.
  if (tiers.length === 0) {
    return poshRsvpFor(e.slug) || e.ticketRedirectUrl ? "on-sale" : "closed";
  }
  return tiers.every(isSoldOut) ? "sold-out" : "on-sale";
}

/** Cheapest live tier - the "from" price on a listing. Null when nothing is on sale. */
export function priceFrom(e: Event): number | null {
  const live = admissionTiers(e.slug).filter((t) => !isSoldOut(t));
  if (live.length === 0) return null;
  return Math.min(...live.map((t) => t.priceCents));
}

export const ticketsLeft = (slug: string) =>
  admissionTiers(slug).reduce((n, t) => n + remaining(t), 0);

export const capacityOf = (slug: string) =>
  admissionTiers(slug).reduce((n, t) => n + t.capacity, 0);

/* ---------------------------------------------------------------- pricing -- */

/**
 * Service fee: a percentage of tickets and add-ons, plus a flat amount per paid
 * ticket. A free RSVP with nothing added is genuinely free.
 */
export const SERVICE_RATE = 0.055;
export const SERVICE_FLAT_CENTS = 119;

export type OrderLine = {
  tierId: string;
  tierName: string;
  qty: number;
  unitCents: number;
  admits: number;
  /** A gift, not an admission. No pass is issued and no fee is charged on it. */
  donation?: boolean;
  /** An add-on (drink, spoon): no pass, shown to the door on scan. */
  addon?: boolean;
};

/**
 * A pending order: one event, a quantity per tier, and an optional code.
 *
 * Quantities live here rather than in the URL so a half-built order survives
 * the trip out to sign-in or the age check and back.
 */
export type Cart = {
  eventSlug: string;
  qty: Record<string, number>;
  /** Chosen amount in cents for donation tiers, keyed by tier id. */
  amounts?: Record<string, number>;
  /** Add-on quantities, keyed by add-on id. */
  addons?: Record<string, number>;
};

/**
 * Prices a cart against current inventory.
 *
 * Quantities are clamped and unknown tiers dropped on every read, so a cart
 * left in storage while a tier sold out or was renamed cannot check out at a
 * stale price or for stock that no longer exists.
 */
export function linesFromCart(cart: Cart | null): OrderLine[] {
  if (!cart) return [];
  const tickets = tiersFor(cart.eventSlug)
    .map((t) => ({
      tierId: t.id,
      tierName: t.name,
      qty: Math.min(cart.qty[t.id] ?? 0, maxSelectable(t)),
      // A donation is worth whatever was typed into it; every other tier is
      // worth its listed price, whatever an old cart may claim.
      unitCents: t.donation
        ? Math.max(t.minCents ?? 0, cart.amounts?.[t.id] ?? 0)
        : t.priceCents,
      admits: admitsOf(t),
      donation: t.donation,
    }))
    .filter((l) => l.qty > 0 && (!l.donation || l.unitCents > 0));

  // Add-ons ride on a ticket. Without one in the cart they are dropped rather
  // than sold on their own - there is nothing at the door to attach them to.
  if (!tickets.some((l) => !l.donation)) return tickets;
  const extras = addonsOn()
    .map((a) => ({
      tierId: `addon:${a.id}`,
      tierName: a.name,
      qty: Math.min(cart.addons?.[a.id] ?? 0, a.maxPerOrder),
      unitCents: a.priceCents,
      admits: 0,
      addon: true,
    }))
    .filter((l) => l.qty > 0);
  return [...tickets, ...extras];
}

export const cartCount = (cart: Cart | null) =>
  linesFromCart(cart).reduce((n, l) => n + l.qty, 0);

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
  totalCents: number;
  /** Tickets, not heads, not donations and not add-ons. */
  ticketCount: number;
  /** Heads - a table for six counts as six. */
  admitCount: number;
  /** Of the subtotal, the part that is a gift rather than an admission. */
  donationCents: number;
};

export function totalsFor(lines: OrderLine[]): Totals {
  const subtotalCents = lines.reduce((n, l) => n + l.unitCents * l.qty, 0);
  const ticketCount = lines.reduce(
    (n, l) => n + (l.donation || l.addon ? 0 : l.qty),
    0,
  );
  const admitCount = lines.reduce((n, l) => n + l.qty * l.admits, 0);
  const donationCents = lines.reduce(
    (n, l) => n + (l.donation ? l.unitCents * l.qty : 0),
    0,
  );
  // Fees ride on tickets and add-ons, never on a gift: taking a cut of a
  // donation would be a strange thing to put in front of someone choosing to
  // give. The flat part is per paid ticket only.
  const paidCount = lines.reduce(
    (n, l) => n + (!l.donation && !l.addon && l.unitCents > 0 ? l.qty : 0),
    0,
  );
  const feeable = subtotalCents - donationCents;

  // Must match create-ticket-checkout exactly, or the Stripe page shows a
  // different number from the one on the site.
  const feeCents =
    feeable === 0
      ? 0
      : Math.round(feeable * SERVICE_RATE) + SERVICE_FLAT_CENTS * paidCount;

  return {
    subtotalCents,
    discountCents: 0,
    feeCents,
    totalCents: subtotalCents + feeCents,
    ticketCount,
    admitCount,
    donationCents,
  };
}

/* ------------------------------------------------------------- formatting -- */

/** Listing price: $0 reads as "Free". */
export const money = (cents: number) =>
  cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;

/** Ledger price: always numeric, so a $0.00 line still lines up under a total. */
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/* --------------------------------------------------------------- calendar -- */

const pad = (n: number) => String(n).padStart(2, "0");

/** "9:00 PM" to [21, 0]. Null for anything it cannot read. */
function parseClock(time: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!m) return null;
  const [, h, min, mer] = m;
  let hour = Number(h) % 12;
  if (mer.toUpperCase() === "PM") hour += 12;
  return [hour, Number(min)];
}

const stamp = (date: string, clock: [number, number]) =>
  `${date.replace(/-/g, "")}T${pad(clock[0])}${pad(clock[1])}00`;

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * Minimal VCALENDAR for one event.
 *
 * Times are written floating - no Z, no TZID - so a phone shows the door time
 * exactly as printed on the flyer wherever it is opened. The city is New York;
 * converting to the reader's own zone would be wrong, not helpful.
 */
export function icsFor(slug: string, orderId: string): string | null {
  const e = findEvent(slug);
  if (!e) return null;
  const start = parseClock(e.time);
  if (!start) return null;

  // Fall back to a four-hour night when the flyer gives no closing time.
  const end = (e.endTime ? parseClock(e.endTime) : null) ?? [
    (start[0] + 4) % 24,
    start[1],
  ];
  // An end at or before the start means the night runs past midnight.
  const rollsOver =
    end[0] < start[0] || (end[0] === start[0] && end[1] <= start[1]);
  const endsAt = stamp(rollsOver ? nextDay(e.date) : e.date, end);

  // No address. Where a night happens is emailed to the list before the date
  // and is never written into anything that leaves the site.
  const where = `New York City - address emailed from ${org.email} before the night`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WECAMETOOPARTY//Tickets//EN",
    "BEGIN:VEVENT",
    `UID:${orderId}@wecametooparty`,
    `DTSTART:${stamp(e.date, start)}`,
    `DTEND:${endsAt}`,
    `SUMMARY:${e.title}`,
    `LOCATION:${where}`,
    `DESCRIPTION:Order ${orderId}. Bring your QR code to the door.`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
