import { findEvent, org, TODAY, type Event } from "./events";

/**
 * Ticket inventory, pricing and order maths.
 *
 * Pure module - no React, no storage. `lib/demo-account.tsx` owns the cart and
 * the placed orders; this file owns what a ticket costs and whether one is
 * still available, so the picker and the checkout price an order the same way
 * instead of each doing its own arithmetic.
 *
 * PRICING CAVEAT: every tier priced differently from its event's `priceCents`
 * is a placeholder, exactly like the base prices in `lib/events.ts`. The base
 * tier of an event always matches that event's `priceCents`, so correcting the
 * Posh-confirmed number in one place still moves the door price here. The
 * `sold` counts are fixed sample stock, not live inventory.
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
  /** Heads this one ticket lets through the door. A table admits its party. */
  admits?: number;
  /**
   * A donation, not an admission: the giver names the amount, it admits nobody
   * and it is left out of stock counts, "from" prices and the service fee.
   */
  donation?: boolean;
  /** Smallest accepted amount, in cents. Donations only. */
  minCents?: number;
};

/** Tiers keyed by event slug. An event with no entry is not on sale. */
const TIERS: Record<string, Tier[]> = {
  wecametoofurr: [
    {
      id: "rsvp",
      name: "Free RSVP",
      priceCents: 0,
      blurb: "Location is sent to you on the day of the event.",
      capacity: 150,
      sold: 73,
      maxPerOrder: 2,
    },
    {
      id: "donate",
      name: "Donation",
      priceCents: 0,
      blurb: "Chip in for sound, lights and the next one. Any amount helps.",
      // Nothing to run out of, so the capacity here is only there to satisfy
      // the shape every tier shares; `donation` keeps it out of stock maths.
      capacity: Number.MAX_SAFE_INTEGER,
      sold: 0,
      maxPerOrder: 1,
      admits: 0,
      donation: true,
      minCents: 100,
    },
  ],
  "saviis-21st-color-wave": [
    {
      id: "rsvp",
      name: "Free RSVP",
      priceCents: 0,
      blurb: "Dress code is colour. All of it.",
      capacity: 100,
      sold: 92,
      maxPerOrder: 2,
    },
    {
      id: "kit",
      name: "RSVP + Colour Kit",
      priceCents: 1200,
      blurb: "Paint, chalk and a poncho waiting at the door.",
      capacity: 60,
      sold: 21,
      maxPerOrder: 4,
    },
  ],
  wecametooswag: [
    {
      id: "rsvp",
      name: "Free RSVP",
      priceCents: 0,
      capacity: 200,
      sold: 9,
      maxPerOrder: 4,
    },
  ],
  "sniff-snort-pt-2": [
    {
      id: "early",
      name: "Early Bird",
      priceCents: 1000,
      blurb: "First fifty only.",
      capacity: 50,
      sold: 50,
      maxPerOrder: 4,
    },
    {
      id: "ga",
      name: "General Admission",
      priceCents: 1500,
      capacity: 150,
      sold: 61,
      maxPerOrder: 6,
    },
    {
      id: "four",
      name: "Group Of Four",
      priceCents: 5000,
      blurb: "One code, four heads through the door.",
      capacity: 25,
      sold: 4,
      maxPerOrder: 2,
      admits: 4,
    },
  ],
  wecametoocosplay: [
    {
      id: "early",
      name: "Early Bird",
      priceCents: 1500,
      blurb: "Gone.",
      capacity: 60,
      sold: 60,
      maxPerOrder: 4,
    },
    {
      id: "ga",
      name: "General Admission",
      priceCents: 2000,
      capacity: 180,
      sold: 44,
      maxPerOrder: 6,
    },
    {
      id: "vip",
      name: "VIP + Contest Entry",
      priceCents: 3500,
      blurb: "Early entry and a slot in the costume contest.",
      capacity: 40,
      sold: 11,
      maxPerOrder: 4,
    },
  ],
  wecametoohalloween: [
    {
      id: "ga",
      name: "General Admission",
      priceCents: 2500,
      capacity: 300,
      sold: 27,
      maxPerOrder: 6,
    },
    {
      id: "vip",
      name: "VIP",
      priceCents: 4500,
      blurb: "In from noon, private bar, own entrance.",
      capacity: 60,
      sold: 6,
      maxPerOrder: 4,
    },
    {
      id: "table",
      name: "Table For Six",
      priceCents: 25000,
      blurb: "Reserved table, bottle service, six wristbands.",
      capacity: 8,
      sold: 1,
      maxPerOrder: 1,
      admits: 6,
    },
  ],
};

export const tiersFor = (slug: string): Tier[] => TIERS[slug] ?? [];

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
 * Service fee, charged per paid ticket. Free tickets are genuinely free: no fee
 * is ever added to a $0 line.
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
};

export type Promo = {
  code: string;
  kind: "percent" | "flat" | "fees";
  /** Percent for "percent", cents for "flat", unused for "fees". */
  value?: number;
  label: string;
};

/** Demo codes. A live build validates these server-side, not in the bundle. */
export const PROMOS: Promo[] = [
  { code: "WCTP10", kind: "percent", value: 10, label: "10% off tickets" },
  { code: "FIVEOFF", kind: "flat", value: 500, label: "$5 off your order" },
  { code: "GUESTLIST", kind: "fees", label: "Service fees waived" },
];

export const findPromo = (code: string): Promo | null =>
  PROMOS.find((p) => p.code === code.trim().toUpperCase()) ?? null;

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
  promoCode?: string;
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
  return tiersFor(cart.eventSlug)
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
}

export const cartCount = (cart: Cart | null) =>
  linesFromCart(cart).reduce((n, l) => n + l.qty, 0);

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
  totalCents: number;
  /** Tickets, not heads, and not donations. */
  ticketCount: number;
  /** Heads - a table for six counts as six. */
  admitCount: number;
  /** Of the subtotal, the part that is a gift rather than an admission. */
  donationCents: number;
};

export function totalsFor(lines: OrderLine[], promo?: Promo | null): Totals {
  const subtotalCents = lines.reduce((n, l) => n + l.unitCents * l.qty, 0);
  const ticketCount = lines.reduce((n, l) => n + (l.donation ? 0 : l.qty), 0);
  const admitCount = lines.reduce((n, l) => n + l.qty * l.admits, 0);
  const donationCents = lines.reduce(
    (n, l) => n + (l.donation ? l.unitCents * l.qty : 0),
    0,
  );
  // Fees ride on tickets only. Taking a cut of a gift would be a strange thing
  // to put in front of someone choosing to give.
  const paidCount = lines.reduce(
    (n, l) => n + (!l.donation && l.unitCents > 0 ? l.qty : 0),
    0,
  );

  // Codes discount tickets, never the gift: a promo should not quietly shrink
  // the amount someone chose to give.
  const ticketSubtotal = subtotalCents - donationCents;
  let discountCents = 0;
  if (promo?.kind === "percent")
    discountCents = Math.round((ticketSubtotal * (promo.value ?? 0)) / 100);
  if (promo?.kind === "flat")
    discountCents = Math.min(ticketSubtotal, promo.value ?? 0);

  const discounted = subtotalCents - discountCents;

  let feeCents =
    paidCount === 0
      ? 0
      : Math.round(discounted * SERVICE_RATE) + SERVICE_FLAT_CENTS * paidCount;
  if (promo?.kind === "fees") feeCents = 0;

  return {
    subtotalCents,
    discountCents,
    feeCents,
    totalCents: discounted + feeCents,
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
