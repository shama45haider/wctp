"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Flyer from "./Flyer";
import EventLink from "./EventLink";
import { heroPhoto, monthOf, dayOf, type Event } from "@/lib/events";
import { isPastEvent, money, priceFrom } from "@/lib/tickets";
import { useNow } from "@/lib/now";

/**
 * Upcoming dates as a wall of flyers.
 *
 * This replaced a vertical list that put every date the same distance down the
 * page - the soonest one no more visible than the fifth. A flyer is the thing
 * people actually recognise, so it leads at a size worth looking at and the
 * rest are swiped to.
 *
 * The look is posters taped up outside a venue rather than cards in an
 * interface: every one hangs a degree or two off square, throws the soft
 * shadow paper throws, wears the same grain the rest of the page does, and
 * straightens when you put a cursor on it. Nothing is rounded and nothing
 * glows - see the wall-* block in globals.css. The only colour that is not the
 * site's own comes out of the artwork.
 *
 * Native scroll-snap does the scrolling. No carousel library, no transform
 * track, no autoplay: a horizontal list of links the browser already knows how
 * to flick through on a phone, with arrows added for a mouse. It is still a
 * readable list of links in order with JavaScript broken.
 */

function Poster({ e, linked, now }: { e: Event; linked: boolean; now: Date }) {
  const past = isPastEvent(e, now);
  const from = priceFrom(e);
  const photo = heroPhoto(e);

  return (
    <EventLink
      slug={e.slug}
      hasPage={linked}
      // A date published since the last build has no static page yet, and
      // EventLink renders it as plain text rather than a link to a 404.
      className="wall-poster relative block w-[76vw] shrink-0 p-2.5 sm:w-[43vw] lg:w-[306px]"
    >
      <div
        className={`wall-grain relative aspect-[4/5] overflow-hidden ${
          past ? "wall-past" : ""
        }`}
      >
        {photo || e.imageId ? (
          <Flyer
            id={e.imageId}
            src={photo ?? undefined}
            alt={e.title}
            sizes="(max-width:639px) 76vw, (max-width:1023px) 43vw, 306px"
            maxWidth={640}
          />
        ) : (
          <div className="hairline-x flex h-full items-center justify-center bg-ink2">
            <span className="label text-silverfaint">NO FLYER</span>
          </div>
        )}
      </div>

      {/* Set like the bottom of a gig poster: the day huge and condensed, the
          month and weekday stacked small beside it, the title under a rule. */}
      <div className="px-1 pt-3 pb-1">
        <div className="flex items-end gap-2">
          <span className="font-display text-[2.6rem] leading-[0.78] tracking-[-0.01em] text-chalk">
            {dayOf(e.date)}
          </span>
          <span className="label pb-1 leading-tight text-silverdim">
            {monthOf(e.date)}
            <br />
            {e.dow}
          </span>
          <span className="label ml-auto pb-1 text-right text-silverfaint">
            {e.time}
            {from !== null && !past && (
              <>
                <br />
                <span className="text-chalk">
                  {from > 0 ? money(from) : "FREE"}
                </span>
              </>
            )}
          </span>
        </div>

        <p className="font-display mt-2.5 border-t border-linehi pt-2.5 text-[1.05rem] leading-[1.05] break-words uppercase">
          {e.title}
        </p>
      </div>
    </EventLink>
  );
}

export default function EventCarousel({
  events,
  hasPage,
}: {
  events: Event[];
  hasPage: (slug: string) => boolean;
}) {
  const now = useNow();
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [ends, setEnds] = useState({ start: true, end: false });
  /**
   * Whether the track actually overflows.
   *
   * Three posters on a desk fit side by side with room to spare, and the
   * controls under them were then a pair of permanently disabled arrows beside
   * dots that marked the middle one as "current" - because with nothing to
   * scroll, the poster nearest the centre of the viewport is the middle one.
   * Both were furniture pretending to be controls.
   */
  const [overflows, setOverflows] = useState(false);

  /**
   * Which poster is nearest the middle, worked out from scrollLeft rather than
   * tracked as state the arrows also write to. Swiping, the arrows and a
   * keyboard all move the same scroll position, so reading it back is the only
   * version that cannot disagree with what is on screen.
   */
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const cards = [...el.children] as HTMLElement[];
    if (cards.length === 0) return;

    const middle = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestGap = Infinity;
    cards.forEach((c, i) => {
      const gap = Math.abs(c.offsetLeft + c.offsetWidth / 2 - middle);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    setAt(best);
    // Measured across the posters themselves, not scrollWidth, which counts
    // the track's own trailing padding - enough on a desk to report 27px of
    // "overflow" and draw a full set of controls for scrolling past nothing.
    const span =
      cards[cards.length - 1].offsetLeft +
      cards[cards.length - 1].offsetWidth -
      cards[0].offsetLeft;
    setOverflows(span > el.clientWidth + 2);
    setEnds({
      start: el.scrollLeft <= 2,
      // A pixel of slack: fractional widths mean scrollLeft rarely lands
      // exactly on the maximum, and an arrow that never enables is worse
      // than one that enables a pixel early.
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure, events.length]);

  const slideTo = (i: number) => {
    const el = track.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    el.scrollTo({
      left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2,
      behavior: "smooth",
    });
  };

  if (events.length === 0) return null;

  return (
    <div>
      <div
        ref={track}
        onScroll={measure}
        className="wall-track -mx-[4vw] flex gap-5 overflow-x-auto px-[4vw] sm:gap-7"
        role="group"
        aria-label="Upcoming dates"
      >
        {events.map((e) => (
          <Poster key={e.slug} e={e} linked={hasPage(e.slug)} now={now} />
        ))}
      </div>

      {/* Nothing to scroll to, nothing to scroll with. */}
      {overflows && (
        <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
          <div className="flex items-center gap-1.5" aria-hidden>
            {events.map((e, i) => (
              <button
                key={e.slug}
                type="button"
                onClick={() => slideTo(i)}
                tabIndex={-1}
                className={`wall-dot h-[3px] ${i === at ? "wall-dot-on w-7" : "w-3.5"}`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => slideTo(at - 1)}
              disabled={ends.start}
              aria-label="Previous date"
              className="wall-arrow flex h-11 w-11 items-center justify-center text-[0.95rem] leading-none"
            >
              &larr;
            </button>
            <button
              type="button"
              onClick={() => slideTo(at + 1)}
              disabled={ends.end}
              aria-label="Next date"
              className="wall-arrow flex h-11 w-11 items-center justify-center text-[0.95rem] leading-none"
            >
              &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
