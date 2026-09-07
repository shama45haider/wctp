export type Event = {
  slug: string;
  title: string;
  date: string;
  dow: string;
  time: string;
  endTime?: string;
  imageId?: string;
  going?: number;
  note?: string;
  /**
   * Ticket price in cents; 0 is a free RSVP.
   * Posh confirms WECAMETOOFURR starts at $0.00. The non-zero values below are
   * PLACEHOLDERS — replace them with real door prices before launch.
   */
  priceCents?: number;
};

/*
 * Where a night happens is deliberately not on the site. The address goes out
 * by email, from `org.email`, to everyone on the list before every date - so
 * there is no venue field here, nothing renders one, and a listing never says
 * more than when.
 */

const POSH_CDN =
  "https://posh.vip/cdn-cgi/image/width=1080,quality=75,fit=scale-down,format=auto/https://images.posh.vip/originals/";

export const flyer = (id?: string) => (id ? POSH_CDN + id : null);

export const upcoming: Event[] = [
  {
    slug: "wecametoofurr",
    priceCents: 0,
    title: "WECAMETOOFURR",
    date: "2026-09-04",
    dow: "FRI",
    time: "9:00 PM",
    imageId: "6a8e486ab58c7e988a359e63",
    going: 73,
    note: "The location will be emailed to everyone on the list. Check @wearethepartynyc but RSVP first.",
  },
  {
    slug: "saviis-21st-color-wave",
    priceCents: 0,
    title: "SAVII'S 21st Color Wave",
    date: "2026-09-08",
    dow: "TUE",
    time: "9:00 PM",
    endTime: "4:00 AM",
    imageId: "6a8ba177d4303495287128a5",
    going: 92,
    note: "IMSAVIILOLIIBOYY x WECAMETOOPARTY. Dress code: color full. Get on the list and the address comes to your inbox.",
  },
  {
    slug: "wecametooswag",
    priceCents: 0,
    title: "WECAMETOOSWAG",
    date: "2026-09-11",
    dow: "FRI",
    time: "9:00 PM",
    endTime: "4:00 AM",
    imageId: "6a61e994d5ae088d4c5d512a",
    going: 9,
  },
  {
    slug: "sniff-snort-pt-2",
    priceCents: 1500,
    title: "Sniff & Snort PT 2",
    date: "2026-10-02",
    dow: "FRI",
    time: "6:00 PM",
    imageId: "69b1e7cad944bc9503b2010b",
  },
  {
    slug: "wecametoocosplay",
    priceCents: 2000,
    title: "WECAMETOOCOSPLAY",
    date: "2026-10-17",
    dow: "SAT",
    time: "9:30 PM",
    imageId: "6a93eeff27b5bf23b369e493",
  },
  {
    slug: "wecametoohalloween",
    priceCents: 2500,
    title: "WECAMETOOHALLOWEEN",
    date: "2026-10-31",
    dow: "SAT",
    time: "12:00 PM",
    endTime: "3:00 AM",
    imageId: "6a4f7c176ade370f3048de7c",
    going: 27,
  },
];

export const past: Event[] = [
  { slug: "slave-to-dancefloor", title: "SLAVE TO DANCEFLOOR", date: "2026-08-28", dow: "FRI", time: "9:00 PM", imageId: "6a8e530f491d7e6da0e866b3" },
  { slug: "blackout-v", title: "BLACKOUT V: DANCE TIL YOUR DEAD", date: "2026-08-21", dow: "FRI", time: "9:00 PM", imageId: "6a82681515f1da1ac9481536" },
  { slug: "hood-rager-rave", title: "HOOD RAGER RAVE", date: "2026-08-14", dow: "FRI", time: "9:00 PM", imageId: "6a7cd02f1b6881caf79e2942" },
  { slug: "wecametoojamaiga", title: "WECAMETOOJAMAIGA", date: "2026-08-08", dow: "SAT", time: "9:00 PM", imageId: "6a777dd94d42f83f53a8c85b" },
  { slug: "just-dance", title: "JUST DANCE", date: "2026-08-07", dow: "FRI", time: "10:00 PM", imageId: "6a7052bea23897acb1e672a7" },
  { slug: "cut-the-water", title: "CUT THE WATER", date: "2026-07-24", dow: "FRI", time: "8:00 PM", imageId: "6a5e459854bc2bd7c742daa9" },
  { slug: "skate-and-snort", title: "skate and snort", date: "2026-07-17", dow: "FRI", time: "9:00 PM", imageId: "6a5359199e1819e5a8656b2b" },
  { slug: "mastertripsitters-birthday-bbq", title: "MASTERTRIPSITTER'S BIRTHDAY BBQ", date: "2026-07-15", dow: "WED", time: "12:00 PM" },
  { slug: "skate-park-party", title: "SKATE PARK PARTY", date: "2026-07-10", dow: "FRI", time: "9:00 PM", imageId: "6a4fb9fc7ef51ea6c62e96d3" },
  { slug: "fuck-amerikkka", title: "Fuck Amerikkka", date: "2026-07-04", dow: "SAT", time: "4:00 PM", imageId: "6a304fb482064acdf3ff4d2e" },
  { slug: "wecametoowater-fight", title: "WECAMETOOWATER FIGHT", date: "2026-07-03", dow: "FRI", time: "9:00 PM", imageId: "6a4403ad3dcc7289c00265c1" },
  { slug: "wecametoopride", title: "WECAMETOOPRIDE", date: "2026-06-28", dow: "SUN", time: "11:00 AM", imageId: "69d0cb36be817e799bb69245" },
];

/**
 * Canonical origin. Ticket QRs always point here, even when rendered from a dev
 * server - a ticket is scanned by someone else's phone, where localhost is not
 * a place.
 */
export const SITE_ORIGIN = "https://wecametooparty.com";

export const org = {
  name: "WECAMETOOPARTY",
  instagram: "https://www.instagram.com/wearethepartynyc/",
  instagramHandle: "@wearethepartynyc",
  /**
   * The one address for anything that matters: the location drop before each
   * night, the outcome of an age check, a ticket that went missing. Every
   * "write to us" on the site points here.
   */
  email: "party@wecametooparty.com",
  posh: "https://posh.vip/g/wecametooparty",
  totalEvents: 42,
  totalAttendees: 4342,
  bio: "It's in the name OKK so don't ask — just get lit. Smoke sum, drink sum, pop sum if u want. Everything is optional.",
};

/**
 * "Now", pinned to whatever it was on the last deploy rather than read from
 * the clock - this is the one instant every page can render against during
 * the static export, so the first paint the export ships and the first
 * client render agree and hydration has nothing to disagree about.
 *
 * Nothing needs to move this forward by hand any more. lib/now.ts reads the
 * visitor's real clock instead the moment a page has mounted, which is what
 * actually decides whether a date has passed - see useNow() and
 * useRuntimeEvents(). This stays only as that shared starting point, and as
 * the fallback for isPastEvent()/saleState() callers that never ask for the
 * live date at all.
 */
export const TODAY = new Date("2026-09-01");

export const allEvents = [...upcoming, ...past];
export const findEvent = (slug: string) => allEvents.find((e) => e.slug === slug);

export const monthOf = (iso: string) =>
  ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(iso.slice(5, 7)) - 1];
export const dayOf = (iso: string) => iso.slice(8, 10);
