import Link from "next/link";
import { monthOf, dayOf, type Event } from "@/lib/events";
import { money, priceFrom, saleState, ticketsLeft } from "@/lib/tickets";
import Flyer from "./Flyer";

const LOW_STOCK = 25;

function Row({ e }: { e: Event }) {
  const state = saleState(e);
  const from = priceFrom(e);
  const left = ticketsLeft(e.slug);
  const closed = state !== "on-sale";

  return (
    <article className="group relative grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-b border-line px-4 py-5 transition-colors hover:bg-white/[0.022] md:grid-cols-[5rem_6rem_minmax(0,1fr)_12rem_7rem_auto] md:items-center md:gap-6 md:py-6">
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
      <div className="relative row-span-4 aspect-square self-start overflow-hidden border border-line md:row-span-1">
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
          <Link href={`/events/${e.slug}`} className="hover:text-bloodhi">
            {e.title}
          </Link>
        </h3>
        <div className="label mt-0.5 text-silverfaint">WECAMETOOPARTY</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {typeof e.going === "number" && (
            <span className="label inline-block border border-[rgba(200,16,46,0.55)] px-2.5 py-1 text-bloodhi">
              {e.going} GOING
            </span>
          )}
          {state === "on-sale" && left <= LOW_STOCK && (
            <span className="label inline-block border border-line px-2.5 py-1 text-silverdim">
              {left} LEFT
            </span>
          )}
          {state === "sold-out" && (
            <span className="label inline-block border border-line px-2.5 py-1 text-silverdim">
              SOLD OUT
            </span>
          )}
        </div>
      </div>

      <div className="label col-start-2 break-words text-silverdim md:col-start-auto">
        {e.venue.toUpperCase()}
        {e.city && (
          <>
            <br />
            {e.city}
          </>
        )}
      </div>

      <div className="label col-start-2 text-chalk md:col-start-auto">
        <span className="text-bloodhi">
          {closed ? "—" : money(from ?? e.priceCents ?? 0)}
        </span>
        <br />
        {e.time}
        {e.endTime && (
          <>
            <br />
            <span className="text-silverfaint">TIL {e.endTime}</span>
          </>
        )}
      </div>

      <Link
        href={`/events/${e.slug}${closed ? "" : "#tickets"}`}
        className={`font-display col-start-2 flex min-h-11 items-center justify-center border px-[1.15rem] py-[0.7rem] tracking-[0.12em] uppercase transition-all md:col-start-auto md:justify-self-start ${
          closed
            ? "border-linehi text-silverdim hover:border-silverdim hover:text-chalk"
            : "border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] text-chalk hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)]"
        }`}
      >
        {closed ? "Details" : "Tickets"}
      </Link>
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
export default function EventManifest({ events }: { events: Event[] }) {
  return (
    <div className="border-t border-line">
      {events.map((e) => (
        <Row key={e.slug} e={e} />
      ))}
    </div>
  );
}
