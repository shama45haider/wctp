import { Bagel_Fat_One, Fredoka } from "next/font/google";

/**
 * The raffle's own fonts: a chunky bubble face for headings and a rounded one
 * for everything else. Only the raffle box uses them, so they aren't
 * preloaded - the files download the first time the box renders, not on
 * every page view.
 */
export const bubble = Bagel_Fat_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bubble",
  display: "swap",
  preload: false,
});

export const round = Fredoka({
  subsets: ["latin"],
  variable: "--font-round",
  display: "swap",
  preload: false,
});
