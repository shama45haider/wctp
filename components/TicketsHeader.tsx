"use client";

import Link from "next/link";
import { Editable } from "./Editable";
import { monthOf, dayOf } from "@/lib/events";
import type { RuntimeEventList } from "@/lib/events-runtime";
import { money, priceFrom, saleState, ticketsLeft } from "@/lib/tickets";

/**
 * The facts strip and "NEXT UP" line at the top of /tickets.
 *
 * Takes `runtime` from useRuntimeEvents as a prop rather than calling the
 * hook itself - TicketsPageBody calls it once for the whole page and hands
 * the same answer to this, TicketsBrowser and RuntimeEvents, so ON SALE and
 * NEXT here can never drift from what TicketsBrowser shows underneath, and
 * the dashboard's events table is only ever fetched once per visit rather
 * than once per component. See lib/now.ts.
 */
export default function TicketsHeader({ runtime }: { runtime: RuntimeEventList }) {
  const { upcoming, now } = runtime;

  const onSale = upcoming.filter((e) => saleState(e, now) === "on-sale");
  const nextUp = onSale[0] ?? upcoming[0];
  const cheapest = onSale
    .map((e) => priceFrom(e) ?? 0)
    .reduce((a, b) => Math.min(a, b), Infinity);

  return (
    <>
      {/* Facts strip: wraps to two rows on a phone instead of shrinking. */}
      <dl className="label mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
        <div>
          <dt className="text-silverfaint">
            <Editable k="tickets.facts.onSale">ON SALE</Editable>
          </dt>
          <dd className="font-display mt-1 text-[1.5rem]">
            {String(onSale.length).padStart(2, "0")}
          </dd>
        </div>
        <div>
          <dt className="text-silverfaint">
            <Editable k="tickets.facts.from">FROM</Editable>
          </dt>
          <dd className="font-display mt-1 text-[1.5rem]">
            {money(Number.isFinite(cheapest) ? cheapest : 0)}
          </dd>
        </div>
        <div>
          <dt className="text-silverfaint">
            <Editable k="tickets.facts.next">NEXT</Editable>
          </dt>
          <dd className="font-display mt-1 text-[1.5rem]">
            {nextUp ? `${dayOf(nextUp.date)} ${monthOf(nextUp.date)}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-silverfaint">
            <Editable k="tickets.facts.spotsLeft">SPOTS LEFT</Editable>
          </dt>
          <dd className="font-display mt-1 text-[1.5rem]">
            {onSale.reduce((n, e) => n + ticketsLeft(e.slug), 0)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        {nextUp ? (
          <>
            <span className="dot shrink-0" />
            <span className="label text-bloodhi">
              <Editable k="tickets.nextUp.label">NEXT UP</Editable>
            </span>
            {/* Padded to a thumb and pulled back with a matching negative
                margin, so the row keeps its height while the tap target
                stops being a 24px line of text. */}
            <Link
              href={`/events/${nextUp.slug}#tickets`}
              className="font-display -my-2.5 inline-block py-2.5 text-[1.6rem] transition-colors hover:text-bloodhi"
            >
              {nextUp.title}
            </Link>
          </>
        ) : (
          <span className="label text-silverfaint">
            <Editable k="tickets.nextUp.none">NOTHING ON SALE RIGHT NOW</Editable>
          </span>
        )}
        <Link
          href="/account"
          className="label ml-auto flex min-h-11 items-center border border-linehi px-4 text-silverdim transition-colors hover:border-silverdim hover:text-chalk"
        >
          MY TICKETS &rarr;
        </Link>
      </div>
    </>
  );
}
