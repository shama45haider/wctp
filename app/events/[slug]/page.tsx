import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import EventManifest from "@/components/EventManifest";
import { allEvents, findEvent, flyer, monthOf, dayOf, org } from "@/lib/events";

export const dynamicParams = false;

export function generateStaticParams() {
  return allEvents.map((e) => ({ slug: e.slug }));
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = findEvent(slug);
  if (!event) notFound();

  const src = flyer(event.imageId);
  const isPast = new Date(event.date) < new Date("2026-09-01");

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,5rem)]">
      <Link href="/#events" className="label text-silverfaint hover:text-chalk">
        &larr; ALL EVENTS
      </Link>

      <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <div className="label mb-4 flex items-center gap-2 text-silverfaint">
            {org.name}
          </div>

          <h1 className="font-display chrome text-[clamp(2.5rem,7vw,5rem)]">
            {event.title}
          </h1>

          <div className="mt-8 flex flex-wrap gap-x-12 gap-y-6 border-y border-line py-6">
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
              <div className="font-display text-2xl">{event.venue}</div>
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
          </div>

          {event.note && (
            <p className="mt-6 max-w-[60ch] leading-relaxed text-silverdim">
              {event.note}
            </p>
          )}

          {isPast ? (
            <div className="label mt-8 inline-block border border-line px-4 py-3 text-silverfaint">
              THIS EVENT HAS PASSED
            </div>
          ) : (
            <div className="mt-8">
              <EventManifest events={[event]} />
            </div>
          )}
        </div>

        <div className="relative aspect-square overflow-hidden border border-line bg-ink">
          {src ? (
            <Image
              src={src}
              alt={event.title}
              fill
              sizes="(max-width:768px) 92vw, 380px"
              className={`object-cover ${isPast ? "grayscale-[0.4]" : ""}`}
              priority
            />
          ) : (
            <div className="label flex h-full items-center justify-center text-silverfaint">
              NO FLYER
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
