import Link from "next/link";
import { notFound } from "next/navigation";
import TicketPicker from "@/components/TicketPicker";
import SongRequestBox from "@/components/SongRequestBox";
import { EventFlyer, EventFromStat } from "@/components/EventLiveBits";
import { Editable } from "@/components/Editable";
import { monthOf, dayOf, org } from "@/lib/events";
import { money, priceFrom } from "@/lib/tickets";
import {
  eventPageSlugs,
  eventShareMetadata,
  findEventForSharing,
} from "@/lib/share-events";

export const dynamicParams = false;

// Every event the site can list: the built-in ones plus whatever the dashboard
// had published when the build ran (see lib/share-events.ts). The built-in list
// alone left dashboard-only dates linked from the home page with no page here.
export function generateStaticParams() {
  return eventPageSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = findEventForSharing(slug);
  if (!event) return {};
  const from = priceFrom(event);
  const title = `${event.title} · WECAMETOOPARTY`;
  const description = `${event.dow} ${dayOf(event.date)} ${monthOf(event.date)}, ${
    event.time
  } · address emailed to the list before the night${
    from === null
      ? ""
      : from > 0
        ? ` · tickets from ${money(from)}`
        : " · free entry"
  }.`;
  return {
    title,
    description,
    // The preview uses this event's own flyer, including one swapped in from
    // the dashboard since the last push.
    ...eventShareMetadata({
      event,
      url: `/events/${event.slug}/`,
      title,
      description,
    }),
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // With any published dashboard edit applied, the same as the listings.
  const event = findEventForSharing(slug);
  if (!event) notFound();

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(1.5rem,5vw,5rem)]">
      <Link
        href="/tickets"
        className="label -my-3 inline-block py-3 text-silverfaint hover:text-chalk"
      >
        &larr; ALL TICKETS
      </Link>

      <div className="mt-6 grid gap-8 md:mt-8 md:grid-cols-[minmax(0,1fr)_380px] md:gap-10">
        {/* The flyer leads on a phone - it is the thing people recognise - then
            moves to the right rail once there is room for two columns. */}
        <div className="relative -order-1 aspect-square overflow-hidden border border-line bg-ink md:order-2">
          <EventFlyer event={event} />
        </div>

        <div className="min-w-0">
          <div className="label mb-3 flex items-center gap-2 text-silverfaint">
            {org.name}
          </div>

          <h1 className="font-display chrome text-[clamp(1.75rem,8.5vw,5rem)] break-words">
            {event.title}
          </h1>

          <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-line py-6 sm:flex sm:flex-wrap sm:gap-x-12">
            <div>
              <div className="label mb-1 text-silverfaint">
                <Editable k="event.stats.when">WHEN</Editable>
              </div>
              <div className="font-display text-2xl">
                {event.dow} {dayOf(event.date)} {monthOf(event.date)}
              </div>
              <div className="label mt-1 text-silverdim">
                {event.time}
                {event.endTime && ` – ${event.endTime}`}{" "}
                <Editable k="event.stats.timezone">EDT</Editable>
              </div>
            </div>
            {/* Never an address. Where a night happens goes out by email to
                the list, and only there - see lib/events.ts. */}
            <div>
              <div className="label mb-1 text-silverfaint">
                <Editable k="event.stats.where">WHERE</Editable>
              </div>
              <div className="font-display text-2xl">
                <Editable k="event.stats.whereValue">By email</Editable>
              </div>
              <div className="label mt-1 text-silverdim">
                <Editable k="event.stats.whereNote">
                  Sent to everyone on the list before the night
                </Editable>
              </div>
            </div>
            {typeof event.going === "number" && (
              <div>
                <div className="label mb-1 text-silverfaint">
                  <Editable k="event.stats.going">GOING</Editable>
                </div>
                <div className="font-display text-2xl">{event.going}</div>
              </div>
            )}
            <EventFromStat event={event} />
          </div>

          {event.note && (
            <p className="mt-6 max-w-[60ch] leading-relaxed text-silverdim">
              {event.note}
            </p>
          )}

          <div className="mt-8">
            <TicketPicker event={event} />
          </div>

          {/* One quiet line under the picker. Anyone here has already decided
              whether they are coming; the request is the afterthought, and it
              is sized like one until it is tapped. */}
          <div className="mt-5">
            <SongRequestBox eventSlug={event.slug} eventTitle={event.title} />
          </div>
        </div>
      </div>
    </main>
  );
}
