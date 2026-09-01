import Link from "next/link";
import { notFound } from "next/navigation";
import TicketPicker from "@/components/TicketPicker";
import Flyer from "@/components/Flyer";
import { allEvents, findEvent, monthOf, dayOf, org } from "@/lib/events";
import { isPastEvent, money, priceFrom, saleState } from "@/lib/tickets";

export const dynamicParams = false;

export function generateStaticParams() {
  return allEvents.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = findEvent(slug);
  if (!event) return {};
  const from = priceFrom(event);
  return {
    title: `${event.title} · WECAMETOOPARTY`,
    description: `${event.dow} ${dayOf(event.date)} ${monthOf(event.date)} at ${
      event.venue
    }${from !== null ? ` · tickets from ${money(from)}` : ""}.`,
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = findEvent(slug);
  if (!event) notFound();

  const past = isPastEvent(event);
  const state = saleState(event);

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
          {event.imageId ? (
            <Flyer
              id={event.imageId}
              alt={event.title}
              sizes="(max-width:767px) 92vw, 380px"
              maxWidth={900}
              priority
              className={past ? "grayscale-[0.4]" : ""}
            />
          ) : (
            <div className="hairline-x label flex h-full items-center justify-center text-silverfaint">
              NO FLYER
            </div>
          )}
          {state === "on-sale" && (
            <span className="label absolute bottom-0 left-0 bg-void/85 px-2.5 py-1.5 text-bloodhi">
              ON SALE NOW
            </span>
          )}
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
              <div className="label mb-1 text-silverfaint">WHEN</div>
              <div className="font-display text-2xl">
                {event.dow} {dayOf(event.date)} {monthOf(event.date)}
              </div>
              <div className="label mt-1 text-silverdim">
                {event.time}
                {event.endTime && ` – ${event.endTime}`} EDT
              </div>
            </div>
            <div>
              <div className="label mb-1 text-silverfaint">WHERE</div>
              <div className="font-display text-2xl break-words">
                {event.venue}
              </div>
              {event.city && (
                <div className="label mt-1 text-silverdim">{event.city}</div>
              )}
            </div>
            {typeof event.going === "number" && (
              <div>
                <div className="label mb-1 text-silverfaint">GOING</div>
                <div className="font-display text-2xl">{event.going}</div>
              </div>
            )}
            {state === "on-sale" && (
              <div>
                <div className="label mb-1 text-silverfaint">FROM</div>
                <div className="font-display text-2xl">
                  {money(priceFrom(event) ?? 0)}
                </div>
              </div>
            )}
          </div>

          {event.note && (
            <p className="mt-6 max-w-[60ch] leading-relaxed text-silverdim">
              {event.note}
            </p>
          )}

          <div className="mt-8">
            <TicketPicker event={event} />
          </div>
        </div>
      </div>
    </main>
  );
}
