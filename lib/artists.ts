/**
 * The people on the roster page, in the order the page shows them: the two
 * CEOs first, then the two DJs, then the artists.
 *
 * Fill a slot in by adding fields to it. A slot with only a number and a role
 * renders as an "announcing soon" placeholder, which is what the CEO and DJ
 * slots are until their names, photos and handles are put in below - nothing
 * else on the site needs touching for that.
 *
 * Photos go in /public/roster and are referenced by path.
 */

export type Role = "ceo" | "dj" | "artist" | "photographer" | "designer" | "promoter";

export type Artist = {
  slot: number;
  role: Role;
  name?: string;
  /** A line under the name - "Founder", "Resident", a crew - if there is one. */
  title?: string;
  bio?: string;
  /** Local path under /public, or a remote URL on an allowed host. */
  imageUrl?: string;
  instagram?: string;
  soundcloud?: string;
};

/** The sections of the page, top to bottom. */
export const ROLES: { id: Role; heading: string; label: string; blurb: string }[] = [
  {
    id: "ceo",
    heading: "The CEOs",
    label: "CEO",
    blurb: "The two who run it.",
  },
  {
    id: "dj",
    heading: "The DJs",
    label: "DJ",
    blurb: "Behind the decks on the night.",
  },
  {
    id: "artist",
    heading: "The Artists",
    label: "ARTIST",
    blurb: "The rest of the family.",
  },
  {
    id: "photographer",
    heading: "The Photographers",
    label: "PHOTOGRAPHER",
    blurb: "Behind the camera on the night.",
  },
  {
    id: "designer",
    heading: "The Graphic Designers",
    label: "GRAPHIC DESIGNER",
    blurb: "The flyers, and the look of it all.",
  },
  {
    id: "promoter",
    heading: "The Promoters",
    label: "PROMOTER",
    blurb: "Getting the word out.",
  },
];

export const roster: Artist[] = [
  // ------------------------------------------------------------- CEOs ----
  // Two slots, waiting on names. Add name, imageUrl and instagram here.
  { slot: 1, role: "ceo" },
  { slot: 2, role: "ceo" },

  // -------------------------------------------------------------- DJs ----
  { slot: 3, role: "dj" },
  { slot: 4, role: "dj" },

  // ---------------------------------------------------------- artists ----
  {
    slot: 5,
    role: "artist",
    name: "ragevvs",
    imageUrl: "/roster/ragevvs.jpg",
    instagram: "https://www.instagram.com/ragevvs",
  },
  {
    slot: 6,
    role: "artist",
    name: "fuckitsoni",
    imageUrl: "/roster/fuckitsoni.jpg",
    instagram: "https://www.instagram.com/fuckitsoni/",
  },
];

export const isFilled = (a: Artist) => Boolean(a.name);

export const byRole = (role: Role) => roster.filter((a) => a.role === role);
