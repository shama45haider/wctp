"use client";

import EventLink from "./EventLink";
import { Editable } from "./Editable";
import { findEvent, monthOf, dayOf } from "@/lib/events";
import { isPastEvent } from "@/lib/tickets";
import type { Order } from "@/lib/demo-account";

/**
 * The nights already behind you.
 *
 * Derived from orders the account page has already loaded rather than asked
 * for separately - the same rows, read the other way round.
 *
 * Two different facts, kept apart on purpose. A pass with `used_at` set was
 * scanned at a door, which is the only evidence the site has that somebody
 * actually turned up. A ticket for a date that has since passed only says they
 * meant to. Collapsing the two would quietly turn "bought and stayed in" into
 * "was there", and this list is going to be the thing XP is counted off later.
 */

type Been = {
  slug: string;
  title: string;
  date: string;
  /** A door scanned at least one pass on this order. */
  checkedIn: boolean;
};

export default function AttendedEvents({
  orders,
  now,
}: {
  orders: Order[];
  now: Date;
}) {
  const byEvent = new Map<string, Been>();

  for (const o of orders) {
    const event = findEvent(o.eventSlug);
    // Without a known date there is no way to say whether it has happened, and
    // a runtime-only event is not in the bundle this page shipped with.
    if (!event || !isPastEvent(event, now)) continue;

    const checkedIn = o.passes.some((p) => p.usedAt);
    const already = byEvent.get(o.eventSlug);
    byEvent.set(o.eventSlug, {
      slug: o.eventSlug,
      title: o.eventTitle || event.title,
      date: event.date,
      // Two orders for one night, one of them scanned, still counts as there.
      checkedIn: checkedIn || Boolean(already?.checkedIn),
    });
  }

  const been = [...byEvent.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (been.length === 0) return null;

  const showed = been.filter((b) => b.checkedIn).length;

  return (
    <section className="mt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <h2 className="font-display text-[2rem]">
          <Editable k="account.been.title">Been to</Editable>
          <span className="label ml-3 align-middle text-silverfaint">
            {been.length}{" "}
            {been.length === 1 ? (
              <Editable k="account.been.night">NIGHT</Editable>
            ) : (
              <Editable k="account.been.nights">NIGHTS</Editable>
            )}
            {showed > 0 && (
              <>
                {" · "}
                {showed} <Editable k="account.been.scanned">SCANNED IN</Editable>
              </>
            )}
          </span>
        </h2>
      </div>

      <ul className="border-t border-line">
        {been.map((b) => (
          <li
            key={b.slug}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-linesoft py-4"
          >
            <span className="label w-20 shrink-0 text-silverfaint">
              {dayOf(b.date)} {monthOf(b.date)}
            </span>
            <EventLink
              slug={b.slug}
              hasPage
              className="font-display min-w-0 flex-1 text-[1.05rem] break-words uppercase transition-colors hover:text-silver"
            >
              {b.title}
            </EventLink>
            <span className="label shrink-0">
              {b.checkedIn ? (
                <span className="text-chalk">
                  <Editable k="account.been.wasThere">WAS THERE</Editable>
                </span>
              ) : (
                <span className="text-silverfaint">
                  <Editable k="account.been.hadTicket">HAD A TICKET</Editable>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
