"use client";

import Flyer from "./Flyer";
import PoshLink from "./PoshLink";
import { Editable } from "./Editable";
import { allEvents, monthOf, dayOf, type Event } from "@/lib/events";
import type { RuntimeEventList } from "@/lib/events-runtime";
import { isPastEvent, poshRsvpFor } from "@/lib/tickets";

/**
 * Dates announced from the dashboard since the site was last built.
 *
 * Only the ones the bundle does not already contain: an edit to a built-in
 * event is merged into the list the page renders from, and repeating it here
 * would print the same night twice.
 *
 * Renders nothing at all when there is nothing to add - no heading, no
 * placeholder, no loading state. This sits under sections that are already full
 * of static content, and on the ordinary night when the database has no extra
 * dates the page should look exactly as it did before this component existed.
 * A database that is down produces no rows either, which is the same silence:
 * see lib/events-runtime.ts for why that failure never reaches the screen.
 *
 * Takes `runtime` as a prop - TicketsPageBody calls useRuntimeEvents once for
 * the whole page and shares it with this, TicketsHeader and TicketsBrowser,
 * rather than each fetching the dashboard's events table on its own.
 */

const BUILT_IN = new Set(allEvents.map((e) => e.slug));

function Card({ e, now }: { e: Event; now: Date }) {
  const past = isPastEvent(e, now);
  const posh = poshRsvpFor(e.slug);

  return (
    <article className="flex flex-col border border-line bg-ink">
      {/* Not a link. TicketsBrowser above lists the same date and links it
          once it has a page; event pages are generated at build time with
          `dynamicParams = false`, so a date added after the last deploy has
          no page to open and a card promising one would land on a 404. */}
      <div className="relative aspect-[4/5] overflow-hidden sm:aspect-[3/4]">
        {e.imageId ? (
          <Flyer
            id={e.imageId}
            alt={e.title}
            sizes="(max-width:639px) 92vw, (max-width:1023px) 46vw, 360px"
            maxWidth={640}
            className={past ? "grayscale" : ""}
          />
        ) : (
          <div className="hairline-x label flex h-full items-center justify-center bg-ink2 text-silverfaint">
            <Editable k="tickets.announced.noFlyer">NO FLYER</Editable>
          </div>
        )}

        <span className="absolute inset-0 bg-gradient-to-t from-[rgba(5,5,5,0.92)] via-[rgba(5,5,5,0.15)] to-transparent" />

        {/* Date block, stamped into the corner of the flyer. */}
        <span className="absolute top-0 left-0 border-r border-b border-linehi bg-void/85 px-3 py-2 text-center backdrop-blur-sm">
          <span className="label block text-silverfaint">
            {e.dow} {monthOf(e.date)}
          </span>
          <span className="font-display block text-[1.6rem] leading-none">
            {dayOf(e.date)}
          </span>
        </span>

        <span className="absolute right-3 bottom-3 left-3">
          <span className="font-display block text-[1.45rem] leading-[1.05] break-words">
            {e.title}
          </span>
        </span>
      </div>

      {e.note && (
        <p className="border-t border-line px-4 py-3 text-sm leading-relaxed text-silverdim">
          {e.note}
        </p>
      )}

      <div className="label mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3.5">
        <span className="text-silverfaint">
          {past ? <Editable k="tickets.announced.pastDate">PAST DATE</Editable> : e.time}
        </span>
        {/* Tiers live in lib/tickets.ts, so a date posted from the dashboard has
            nothing to sell here yet. Saying so beats a button that cannot check
            out - unless its RSVP is on Posh, in which case that is the button. */}
        {!past && posh ? (
          <PoshLink
            href={posh}
            className="-my-3 inline-block py-3 text-bloodhi hover:text-chalk"
          >
            GET TICKETS &rarr;
          </PoshLink>
        ) : (
          <span className={past ? "text-silverfaint" : "text-bloodhi"}>
            {past ? (
              <Editable k="tickets.announced.archive">ARCHIVE</Editable>
            ) : (
              <Editable k="tickets.announced.ticketsSoon">TICKETS SOON</Editable>
            )}
          </span>
        )}
      </div>
    </article>
  );
}

export default function RuntimeEvents({ runtime }: { runtime: RuntimeEventList }) {
  const { events, now } = runtime;
  const added = events.filter((e) => !BUILT_IN.has(e.slug));
  if (added.length === 0) return null;

  return (
    <section className="mt-14 border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="font-display text-[1.75rem]">
          <Editable k="tickets.announced.title">Just announced</Editable>
        </h2>
        <span className="label text-silverfaint">
          {String(added.length).padStart(2, "0")}{" "}
          <Editable k="tickets.announced.newLabel">NEW</Editable>
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {added.map((e) => (
          <Card key={e.slug} e={e} now={now} />
        ))}
      </div>
    </section>
  );
}
