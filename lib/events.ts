export type Event = {
  slug: string;
  title: string;
  date: string;
  dow: string;
  time: string;
  endTime?: string;
  venue: string;
  city?: string;
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
    venue: "Location TBA",
    imageId: "6a8e486ab58c7e988a359e63",
    going: 73,
    note: "The location will be revealed on the event date. Check @wearethepartynyc but RSVP first.",
  },
  {
    slug: "saviis-21st-color-wave",
    priceCents: 0,
    title: "SAVII'S 21st Color Wave",
    date: "2026-09-08",
    dow: "TUE",
    time: "9:00 PM",
    endTime: "4:00 AM",
    venue: "Location TBA",
    imageId: "6a8ba177d4303495287128a5",
    going: 92,
    note: "IMSAVIILOLIIBOYY x WECAMETOOPARTY. Dress code: color full. Get on the list to see location.",
  },
  {
    slug: "wecametooswag",
    priceCents: 0,
    title: "WECAMETOOSWAG",
    date: "2026-09-11",
    dow: "FRI",
    time: "9:00 PM",
    endTime: "4:00 AM",
    venue: "New York",
    city: "NEW YORK, NY",
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
    venue: "TBA",
    imageId: "69b1e7cad944bc9503b2010b",
  },
  {
    slug: "wecametoocosplay",
    priceCents: 2000,
    title: "WECAMETOOCOSPLAY",
    date: "2026-10-17",
    dow: "SAT",
    time: "9:30 PM",
    venue: "Gems Bar & Lounge",
    city: "NEW YORK, NY",
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
    venue: "Washington Square Park",
    city: "NEW YORK, NY 10012",
    imageId: "6a4f7c176ade370f3048de7c",
    going: 27,
  },
];

export const past: Event[] = [
  { slug: "slave-to-dancefloor", title: "SLAVE TO DANCEFLOOR", date: "2026-08-28", dow: "FRI", time: "9:00 PM", venue: "Andy Kessler Skate Park", imageId: "6a8e530f491d7e6da0e866b3" },
  { slug: "blackout-v", title: "BLACKOUT V: DANCE TIL YOUR DEAD", date: "2026-08-21", dow: "FRI", time: "9:00 PM", venue: "Gems Bar", imageId: "6a82681515f1da1ac9481536" },
  { slug: "hood-rager-rave", title: "HOOD RAGER RAVE", date: "2026-08-14", dow: "FRI", time: "9:00 PM", venue: "Amsterdam Ave & W 175 St", imageId: "6a7cd02f1b6881caf79e2942" },
  { slug: "wecametoojamaiga", title: "WECAMETOOJAMAIGA", date: "2026-08-08", dow: "SAT", time: "9:00 PM", venue: "New York, NY", imageId: "6a777dd94d42f83f53a8c85b" },
  { slug: "just-dance", title: "JUST DANCE", date: "2026-08-07", dow: "FRI", time: "10:00 PM", venue: "New York, NY", imageId: "6a7052bea23897acb1e672a7" },
  { slug: "cut-the-water", title: "CUT THE WATER", date: "2026-07-24", dow: "FRI", time: "8:00 PM", venue: "The Garden People, Riverside Dr", imageId: "6a5e459854bc2bd7c742daa9" },
  { slug: "skate-and-snort", title: "skate and snort", date: "2026-07-17", dow: "FRI", time: "9:00 PM", venue: "New York, NY", imageId: "6a5359199e1819e5a8656b2b" },
  { slug: "mastertripsitters-birthday-bbq", title: "MASTERTRIPSITTER'S BIRTHDAY BBQ", date: "2026-07-15", dow: "WED", time: "12:00 PM", venue: "West Harlem Pier" },
  { slug: "skate-park-party", title: "SKATE PARK PARTY", date: "2026-07-10", dow: "FRI", time: "9:00 PM", venue: "Skate Park", imageId: "6a4fb9fc7ef51ea6c62e96d3" },
  { slug: "fuck-amerikkka", title: "Fuck Amerikkka", date: "2026-07-04", dow: "SAT", time: "4:00 PM", venue: "Brighton Beach", imageId: "6a304fb482064acdf3ff4d2e" },
  { slug: "wecametoowater-fight", title: "WECAMETOOWATER FIGHT", date: "2026-07-03", dow: "FRI", time: "9:00 PM", venue: "Read flyer", imageId: "6a4403ad3dcc7289c00265c1" },
  { slug: "wecametoopride", title: "WECAMETOOPRIDE", date: "2026-06-28", dow: "SUN", time: "11:00 AM", venue: "Washington Square Park", imageId: "69d0cb36be817e799bb69245" },
];

export const org = {
  name: "WECAMETOOPARTY",
  handle: "@wecametooparty",
  instagram: "https://www.instagram.com/wearethepartynyc/",
  instagramHandle: "@wearethepartynyc",
  twitter: "https://twitter.com/wecametooparty",
  posh: "https://posh.vip/g/wecametooparty",
  totalEvents: 42,
  totalAttendees: 4342,
  bio: "It's in the name OKK so don't ask \u2014 just get lit. Smoke sum, drink sum, pop sum if u want. Everything is optional.",
};

/**
 * "Now", pinned rather than read from the clock.
 *
 * Server and client render the same HTML from it, so nothing that depends on
 * whether a date has passed can hydrate differently from how it prerendered.
 * Move this forward when the archive is rolled.
 */
export const TODAY = new Date("2026-09-01");

export const allEvents = [...upcoming, ...past];
export const findEvent = (slug: string) => allEvents.find((e) => e.slug === slug);

export const monthOf = (iso: string) =>
  ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][Number(iso.slice(5, 7)) - 1];
export const dayOf = (iso: string) => iso.slice(8, 10);
