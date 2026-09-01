export type Artist = {
  slot: number;
  name?: string;
  role?: string;
  bio?: string;
  /** Local path under /public, or a remote URL on an allowed host. */
  imageUrl?: string;
  instagram?: string;
  soundcloud?: string;
};

/**
 * Four roster slots. Fill in a slot by adding the fields; any slot left with
 * only its number renders as an empty placeholder on /artists.
 */
export const artists: Artist[] = [
  { slot: 1 },
  { slot: 2 },
  { slot: 3 },
  { slot: 4 },
];

export const isFilled = (a: Artist) => Boolean(a.name);
