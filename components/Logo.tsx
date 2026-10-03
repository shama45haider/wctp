import { asset } from "@/lib/asset";

/**
 * The WE CAME TOO PARTY mark. One drawing, several finishes, and each part of
 * the site wears its own:
 *
 *   clean          the nav, app icons and the raffle wheel's hub - the only
 *                  finish that still reads at 40px
 *   red-halftone   the home page, and every link preview without a flyer
 *   grunge         the footer
 *   cyan-halftone  the raffle, to match its stickers
 *   halftone       signing in and signing up
 *
 * The files are cut out of the originals in brand/originals onto transparency,
 * so they sit on any of the site's blacks. The sizes are the files' own, given
 * so the page holds the space before the picture lands.
 */
const FINISHES = {
  clean: { w: 895, h: 864 },
  "red-halftone": { w: 873, h: 835 },
  grunge: { w: 891, h: 861 },
  "cyan-halftone": { w: 670, h: 641 },
  halftone: { w: 873, h: 835 },
} as const;

export type LogoFinish = keyof typeof FINISHES;

export default function Logo({
  finish = "clean",
  alt = "WE CAME TOO PARTY",
  eager = false,
  className = "",
}: {
  finish?: LogoFinish;
  /** Empty when something next to it already says the name. */
  alt?: string;
  /** For a logo that is on screen the moment the page opens. */
  eager?: boolean;
  className?: string;
}) {
  const { w, h } = FINISHES[finish];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset(`/brand/logo-${finish}.webp`)}
      alt={alt}
      width={w}
      height={h}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={`select-none ${className}`}
    />
  );
}
