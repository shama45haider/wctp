"use client";

import Flyer from "./Flyer";
import type { Event } from "@/lib/events";
import { useNow } from "@/lib/now";
import { isPastEvent, money, priceFrom, saleState } from "@/lib/tickets";

/**
 * The two pieces of the event page that say whether tickets are on sale -
 * the flyer's "ON SALE NOW" badge and grayscale, and the FROM price stat.
 *
 * Both used to be decided once, at build time, from the page's own
 * server-rendered saleState(event) - which meant a flyer could keep glowing
 * "ON SALE NOW" days after the date it was selling had already passed,
 * directly above a TicketPicker that (correctly, since it already read the
 * real clock) refused to sell anything. Reading useNow() here instead means
 * the two agree, and both correct themselves the moment a visitor's own
 * browser disagrees with the day the site was last built. See lib/now.ts.
 */

export function EventFlyer({ event }: { event: Event }) {
  const now = useNow();
  const past = isPastEvent(event, now);
  const onSale = saleState(event, now) === "on-sale";

  return event.imageId ? (
    <>
      <Flyer
        id={event.imageId}
        alt={event.title}
        sizes="(max-width:767px) 92vw, 380px"
        maxWidth={900}
        priority
        className={past ? "grayscale-[0.4]" : ""}
      />
      {onSale && (
        <span className="label absolute bottom-0 left-0 bg-void/85 px-2.5 py-1.5 text-bloodhi">
          ON SALE NOW
        </span>
      )}
    </>
  ) : (
    <div className="hairline-x label flex h-full items-center justify-center text-silverfaint">
      NO FLYER
    </div>
  );
}

export function EventFromStat({ event }: { event: Event }) {
  const now = useNow();
  if (saleState(event, now) !== "on-sale") return null;

  return (
    <div>
      <div className="label mb-1 text-silverfaint">FROM</div>
      <div className="font-display text-2xl">
        {money(priceFrom(event) ?? 0)}
      </div>
    </div>
  );
}
