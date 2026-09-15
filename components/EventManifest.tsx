import Link from "next/link";
import { monthOf, dayOf, type Event } from "@/lib/events";
import { money, poshRsvpFor, priceFrom, saleState, ticketsLeft } from "@/lib/tickets";
import EventLink from "./EventLink";
import Flyer from "./Flyer";
import { Editable } from "./Editable";

const LOW_STOCK = 25;

/** `linked` is false for a date the static export has no page for yet. */
function Row({ e, linked }: { e: Event; linked: boolean }) {
  const state = saleState(e);
  const from = priceFrom(e);
  const left = ticketsLeft(e.slug);
  const closed = state !== "on-sale";
  // Open on Posh rather than here: no price or stock to show, and the button
  // goes to Posh - see poshRsvpFor() in lib/tickets.ts.
  const posh = closed ? null : poshRsvpFor(e.slug);
  const button = `font-display col-start-2 flex min-h-11 items-center justify-center border px-[1.15rem] py-[0.7rem] tracking-[0.12em] uppercase transition-all md:col-start-auto md:justify-self-start ${
    closed
      ? "border-linehi text-silverdim hover:border-silverdim hover:text-chalk"
      : "border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] text-chalk hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)]"
  }`;

  return (
    <article className="group relative grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-b border-line px-4 py-5 transition-colors hover:bg-white/[0.022] md:grid-cols-[5rem_6rem_minmax(0,1fr)_7rem_auto] md:items-center md:gap-6 md:py-6">
      <span className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-blood transition-transform group-hover:scale-y-100" />

      {/* Below md the date is stamped onto the flyer instead, so the photo can
          take the column a bare date block would otherwise hold. */}
      <div className="hidden md:block">
        <span className="label block text-silverfaint">
          {e.dow} {monthOf(e.date)}
        </span>
        <span className="font-display text-[2.1rem] leading-none">
          {dayOf(e.date)}
        </span>
      </div>

      {/* Not a link: the title beside it already goes there, and a second
          link to the same place is just an extra stop for keyboard users. */}
      {/* Spans the stacked rows below md so the row height comes from the text
          beside it, instead of leaving a hole under a short first row. */}
      <div className="relative row-span-3 aspect-square self-start overflow-hidden border border-line md:row-span-1">
        {e.imageId ? (
          <Flyer
            id={e.imageId}
            alt=""
            sizes="(max-width:767px) 112px, 96px"
            maxWidth={256}
            className={closed ? "grayscale-[0.5]" : ""}
          />
        ) : (
          <div className="hairline-x h-full w-full bg-ink2 opacity-40" />
        )}
        <span className="absolute inset-x-0 bottom-0 bg-void/85 py-1 text-center backdrop-blur-sm md:hidden">
          <span className="label block leading-none text-silverfaint">
            {e.dow} {monthOf(e.date)}
          </span>
          <span className="font-display block text-[1.25rem] leading-none">
            {dayOf(e.date)}
          </span>
        </span>
      </div>

      <div className="col-start-2 md:col-start-auto">
        <h3 className="font-display text-[1.2rem] break-words sm:text-[1.75rem]">
          {/* Padded out to a thumb and pulled back in with the same negative
              margin globals.css uses on a bare .label link: the title is one
              of only two ways into an event from this row, and at its natural
              23px it was half the height a tap wants. */}
          <EventLink
            slug={e.slug}
            hasPage={linked}
            className="-my-3 inline-block py-3 hover:text-bloodhi"
          >
            {e.title}
          </EventLink>
        </h3>
        <div className="label mt-0.5 text-silverfaint">
          <Editable k="manifest.row.host">WECAMETOOPARTY</Editable>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {typeof e.going === "number" && (
            <span className="label inline-block border border-[rgba(200,16,46,0.55)] px-2.5 py-1 text-bloodhi">
              {e.going} <Editable k="manifest.row.going">GOING</Editable>
            </span>
          )}
          {state === "on-sale" && !posh && left <= LOW_STOCK && (
            <span className="label inline-block border border-line px-2.5 py-1 text-silverdim">
              {left} <Editable k="manifest.row.left">LEFT</Editable>
            </span>
          )}
          {state === "sold-out" && (
            <span className="label inline-block border border-line px-2.5 py-1 text-silverdim">
              <Editable k="manifest.row.soldOut">SOLD OUT</Editable>
            </span>
          )}
        </div>
      </div>

      {/* No where column. The address is emailed to the list before the
          night and is never printed on a listing - see lib/events.ts. */}
      <div className="label col-start-2 text-chalk md:col-start-auto">
        <span className="text-bloodhi">
          {closed ? "—" : posh ? "RSVP" : money(from ?? e.priceCents ?? 0)}
        </span>
        <br />
        {e.time}
        {e.endTime && (
          <>
            <br />
            <span className="text-silverfaint">
              <Editable k="manifest.row.til">TIL</Editable> {e.endTime}
            </span>
          </>
        )}
      </div>

      {/* Straight to Posh for a date that RSVPs there. Otherwise no button at
          all without a page: one that goes nowhere is worse. */}
      {posh ? (
        <a href={posh} className={button}>
          Tickets
        </a>
      ) : (
        linked && (
          <Link
            href={`/events/${e.slug}${closed ? "" : "#tickets"}`}
            className={button}
          >
            {closed ? "Details" : "Tickets"}
          </Link>
        )
      )}
    </article>
  );
}

/**
 * The date list.
 *
 * Every row carries its flyer at all widths - the thumbnail used to be
 * `hidden md:block`, which left phones reading a text-only list of the most
 * visual thing this site has. Below md the layout folds to flyer-plus-stack
 * and the date moves onto the artwork.
 */
export default function EventManifest({
  events,
  hasPage,
}: {
  events: Event[];
  /** From useRuntimeEvents - whether the static export built a page for a slug. */
  hasPage: (slug: string) => boolean;
}) {
  return (
    <div className="border-t border-line">
      {events.map((e) => (
        <Row key={e.slug} e={e} linked={hasPage(e.slug)} />
      ))}
    </div>
  );
}
