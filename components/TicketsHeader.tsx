"use client";

import Link from "next/link";
import EventLink from "./EventLink";
import { Editable } from "./Editable";
import type { RuntimeEventList } from "@/lib/events-runtime";
import { saleState } from "@/lib/tickets";

/**
 * The "NEXT UP" line at the top of /tickets.
 *
 * Takes `runtime` from useRuntimeEvents as a prop rather than calling the
 * hook itself - TicketsPageBody calls it once for the whole page and hands
 * the same answer to this, TicketsBrowser and RuntimeEvents, so NEXT UP here
 * can never drift from what TicketsBrowser shows underneath, and the
 * dashboard's events table is only ever fetched once per visit rather than
 * once per component. See lib/now.ts.
 */
export default function TicketsHeader({ runtime }: { runtime: RuntimeEventList }) {
  const { upcoming, now, hasPage } = runtime;

  const onSale = upcoming.filter((e) => saleState(e, now) === "on-sale");
  const nextUp = onSale[0] ?? upcoming[0];

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-4">
      {nextUp ? (
        <>
          <span className="dot shrink-0" />
          <span className="label text-bloodhi">
            <Editable k="tickets.nextUp.label">NEXT UP</Editable>
          </span>
          {/* Padded to a thumb and pulled back with a matching negative
              margin, so the row keeps its height while the tap target
              stops being a 24px line of text. */}
          <EventLink
            slug={nextUp.slug}
            hash="tickets"
            hasPage={hasPage(nextUp.slug)}
            className="font-display -my-2.5 inline-block py-2.5 text-[1.6rem] transition-colors hover:text-bloodhi"
          >
            {nextUp.title}
          </EventLink>
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
  );
}
