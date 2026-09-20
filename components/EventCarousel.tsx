"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Flyer from "./Flyer";
import EventLink from "./EventLink";
import { bubble, round } from "@/lib/raffle-fonts";
import { heroPhoto, monthOf, dayOf, type Event } from "@/lib/events";
import { isPastEvent, money, priceFrom } from "@/lib/tickets";
import { useNow } from "@/lib/now";

/**
 * Upcoming dates as a swipeable row of flyers.
 *
 * This replaced a vertical list that put every date the same distance down the
 * page - the soonest one no more visible than the fifth. A flyer is the thing
 * people actually recognise, so the carousel leads with it at a size worth
 * looking at and lets the rest be swiped to.
 *
 * Native scroll-snap does the scrolling. No carousel library, no transform
 * track, no autoplay: a horizontal list of links that the browser already
 * knows how to flick through on a phone, with arrows added for a mouse. That
 * also means it still works, and still reads in order, with JavaScript broken -
 * it is a scrolling list of links either way.
 *
 * The sticker look (candy outline, hard offset shadow, no gradients) is the
 * raffle box's, on purpose - see the pop-* block in globals.css.
 */

const FONTS = `${bubble.variable} ${round.variable}`;

function Card({ e, linked, now }: { e: Event; linked: boolean; now: Date }) {
  const past = isPastEvent(e, now);
  const from = priceFrom(e);
  const photo = heroPhoto(e);

  const inner = (
    <>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[19px_19px_0_0]">
        {photo || e.imageId ? (
          <Flyer
            id={e.imageId}
            src={photo ?? undefined}
            alt={e.title}
            sizes="(max-width:639px) 78vw, (max-width:1023px) 44vw, 300px"
            maxWidth={640}
            className={past ? "grayscale" : ""}
          />
        ) : (
          <div className="hairline-x flex h-full items-center justify-center bg-ink2">
            <span className="label text-silverfaint">NO FLYER</span>
          </div>
        )}

        {/* The date rides on the flyer rather than under it: it is the second
            thing anyone wants after recognising the picture. */}
        <span
          className={`pop-pill pop-round absolute top-3 left-3 px-3 py-1 text-[0.875rem] leading-none font-semibold ${
            past ? "opacity-70 grayscale" : ""
          }`}
        >
          {e.dow} {dayOf(e.date)} {monthOf(e.date)}
        </span>

        {from !== null && !past && (
          <span className="pop-pill pop-round absolute top-3 right-3 px-3 py-1 text-[0.875rem] leading-none font-semibold">
            {from > 0 ? money(from) : "FREE"}
          </span>
        )}
      </div>

      <div className="px-4 pt-3 pb-4">
        <p className="pop-title text-[1.15rem] leading-tight break-words">
          {e.title}
        </p>
        <p className="pop-round mt-1.5 text-[0.875rem] text-silverdim">
          {e.time}
          {typeof e.going === "number" && (
            <span className="text-silverfaint"> · {e.going} going</span>
          )}
        </p>
      </div>
    </>
  );

  // A date published since the last build has no static page yet, and
  // EventLink renders it as plain text rather than a link to a 404.
  return (
    <EventLink
      slug={e.slug}
      hasPage={linked}
      className={`pop-card block w-[78vw] shrink-0 overflow-hidden sm:w-[44vw] lg:w-[300px] ${
        past ? "pop-card-past" : ""
      }`}
    >
      {inner}
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
   * Three cards on a desk fit side by side with room to spare, and the
   * controls under them were then a pair of permanently disabled arrows beside
   * dots that marked the middle card as "current" - because with nothing to
   * scroll, the card nearest the centre of the viewport is the middle one. Both
   * were furniture pretending to be controls, so neither is drawn unless there
   * is somewhere to go.
   */
  const [overflows, setOverflows] = useState(false);

  /**
   * Which card is nearest the middle, worked out from scrollLeft rather than
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
    setOverflows(el.scrollWidth > el.clientWidth + 2);
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
    const el = track.current;
    if (!el) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure, events.length]);

  const go = (dir: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    const cards = [...el.children] as HTMLElement[];
    const next = cards[Math.min(Math.max(at + dir, 0), cards.length - 1)];
    if (!next) return;
    el.scrollTo({
      left: next.offsetLeft - (el.clientWidth - next.offsetWidth) / 2,
      behavior: "smooth",
    });
  };

  const jump = (i: number) => {
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
    <div className={FONTS}>
      <div
        ref={track}
        onScroll={measure}
        className="pop-track -mx-[4vw] flex gap-4 overflow-x-auto px-[4vw] pt-1"
        role="group"
        aria-label="Upcoming dates"
      >
        {events.map((e) => (
          <Card key={e.slug} e={e} linked={hasPage(e.slug)} now={now} />
        ))}
      </div>

      {/* Nothing to scroll to, nothing to scroll with. */}
      {overflows && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5" aria-hidden>
            {events.map((e, i) => (
              <button
                key={e.slug}
                type="button"
                onClick={() => jump(i)}
                tabIndex={-1}
                className={`pop-dot h-2 ${i === at ? "pop-dot-on w-6" : "w-2"}`}
              />
            ))}
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={ends.start}
              aria-label="Previous date"
              className="pop-arrow flex h-11 w-11 items-center justify-center text-[1.1rem] leading-none font-bold"
            >
              &larr;
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={ends.end}
              aria-label="Next date"
              className="pop-arrow flex h-11 w-11 items-center justify-center text-[1.1rem] leading-none font-bold"
            >
              &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
