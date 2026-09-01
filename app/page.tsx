import Image from "next/image";
import Link from "next/link";
import EventManifest from "@/components/EventManifest";
import { upcoming, past, org, flyer, monthOf, dayOf } from "@/lib/events";

const next = upcoming[0];

function SectionHead({
  title,
  blurb,
  aside,
}: {
  title: string;
  blurb: string;
  aside?: string;
}) {
  return (
    <div className="mb-10 flex items-end justify-between gap-8 border-b border-line pb-6">
      <div>
        <h2 className="font-display chrome text-[clamp(2.5rem,6vw,4.5rem)]">
          {title}
        </h2>
        <p className="mt-2 max-w-[42ch] text-silverdim">{blurb}</p>
      </div>
      {aside && <div className="label shrink-0 text-silverfaint">{aside}</div>}
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <header className="relative overflow-hidden py-[clamp(3.5rem,9vw,7rem)]">
        <div className="pointer-events-none absolute top-[-30%] left-1/2 h-[70vh] w-[120vw] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(140,155,180,0.13),transparent_62%)]" />
        <div className="relative mx-auto w-[92vw] max-w-[1180px]">
          <div className="label mb-6 flex items-center gap-3 text-silverfaint">
            <span>
              NEW YORK CITY &nbsp;&middot;&nbsp; {org.totalEvents} EVENTS
              &nbsp;&middot;&nbsp; {org.totalAttendees.toLocaleString()} ATTENDEES
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-linehi to-transparent" />
          </div>

          <h1 className="font-display chrome text-[clamp(3rem,12.4vw,10.5rem)] leading-[0.82] tracking-[-0.015em]">
            <span className="block">WE CAME</span>
            <span className="block">TOO PARTY</span>
          </h1>

          <p className="mt-7 max-w-[44ch] text-xl leading-snug text-silverdim">
            {org.bio}
          </p>

          <div className="mt-11 grid items-center gap-6 border border-line bg-gradient-to-b from-ink to-[#08090b] p-6 md:grid-cols-[auto_auto_1fr_auto]">
            <div className="border-b border-dashed border-linehi pb-4 md:border-r md:border-b-0 md:pr-6 md:pb-0 md:text-center">
              <div className="label text-silverfaint">{next.dow}</div>
              <div className="font-display text-[2.75rem] leading-[0.9]">
                {dayOf(next.date)}
              </div>
              <div className="label text-silverfaint">{monthOf(next.date)}</div>
            </div>

            <Link
              href={`/events/${next.slug}`}
              className="relative hidden aspect-square w-28 overflow-hidden border border-line md:block"
            >
              <Image
                src={flyer(next.imageId)!}
                alt={next.title}
                fill
                sizes="112px"
                className="object-cover"
                priority
              />
            </Link>

            <div>
              <div className="label mb-2 flex items-center gap-2 text-bloodhi">
                <span className="dot" />
                RSVP OPEN
              </div>
              <h3 className="font-display text-[clamp(1.75rem,3vw,2.5rem)]">
                {next.title}
              </h3>
              <div className="label mt-1.5 text-silverdim">
                {next.venue.toUpperCase()} &nbsp;&middot;&nbsp; DOORS {next.time}
              </div>
            </div>

            <Link
              href={`/events/${next.slug}`}
              className="font-display justify-self-start border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] px-[1.15rem] py-[0.6rem] tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)]"
            >
              Claim a spot
            </Link>
          </div>
        </div>
      </header>

      <section id="events" className="py-[clamp(3.5rem,7vw,6rem)]">
        <div className="mx-auto w-[92vw] max-w-[1180px]">
          <SectionHead
            title="Upcoming"
            blurb="Locations drop close to the date. Watch the feed and don&rsquo;t be late."
            aside={`${String(upcoming.length).padStart(2, "0")} DATES`}
          />
          <EventManifest events={upcoming} />
        </div>
      </section>

      <section id="dispatches" className="py-[clamp(3.5rem,7vw,6rem)]">
        <div className="mx-auto w-[92vw] max-w-[1180px]">
          <SectionHead
            title="Dispatches"
            blurb="News, location drops and recaps. Straight from the people running the door."
          />
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            <a
              href="https://www.instagram.com/reel/DM-YPL-uKiL/"
              target="_blank"
              rel="noopener"
              className="flex flex-col gap-3 bg-void p-7 transition-colors hover:bg-ink"
            >
              <span className="label text-silverfaint">
                LATEST &middot; INSTAGRAM
              </span>
              <h3 className="font-display text-[1.6rem]">New reel is up</h3>
              <p className="text-sm leading-relaxed text-silverdim">
                Pulled from {org.instagramHandle}. This card feeds straight from
                the Instagram account once it&rsquo;s connected.
              </p>
            </a>
            <div className="flex flex-col gap-3 bg-void p-7">
              <span className="label self-start border border-dashed border-linehi px-2 py-0.5 text-silverfaint">
                DRAFT &middot; NEEDS YOUR COPY
              </span>
              <h3 className="font-display text-[1.6rem]">
                Halloween is going down in Washington Square
              </h3>
              <p className="text-sm leading-relaxed text-silverdim">
                Noon to 3 AM on October 31 in the park. 27 people are already on
                the list.
              </p>
            </div>
            <div className="flex flex-col gap-3 bg-void p-7">
              <span className="label self-start border border-dashed border-linehi px-2 py-0.5 text-silverfaint">
                DRAFT &middot; NEEDS YOUR COPY
              </span>
              <h3 className="font-display text-[1.6rem]">
                Back at Gems for Cosplay
              </h3>
              <p className="text-sm leading-relaxed text-silverdim">
                Second date at Gems Bar &amp; Lounge this year after Blackout V.
                Doors 9:30 on October 17.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="archive" className="py-[clamp(3.5rem,7vw,6rem)]">
        <div className="mx-auto w-[92vw] max-w-[1180px]">
          <SectionHead
            title="Archive"
            blurb="Everything we&rsquo;ve thrown. Nothing gets taken down."
            aside={`${org.totalEvents} EVENTS · ${org.totalAttendees.toLocaleString()} ATTENDEES`}
          />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-5">
            {past.map((e) => {
              const src = flyer(e.imageId);
              return (
                <Link
                  key={e.slug}
                  href={`/events/${e.slug}`}
                  className="group border border-line bg-ink transition-colors hover:border-linehi"
                >
                  <div className="relative h-[180px] overflow-hidden">
                    {src ? (
                      <Image
                        src={src}
                        alt={e.title}
                        fill
                        sizes="(max-width:768px) 100vw, 280px"
                        className="object-cover grayscale transition-[filter] duration-500 group-hover:grayscale-[0.5]"
                      />
                    ) : (
                      <div className="label flex h-full items-center justify-center bg-ink2 text-silverfaint">
                        NO FLYER
                      </div>
                    )}
                    <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(5,5,5,0.85)]" />
                  </div>
                  <div className="px-5 pt-4 pb-6">
                    <h3 className="font-display text-[1.4rem]">{e.title}</h3>
                    <span className="label mt-2 block text-silverfaint">
                      {e.dow} {dayOf(e.date)} {monthOf(e.date)} &middot;{" "}
                      {e.venue.toUpperCase()}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="label mt-10 border border-dashed border-linehi p-5 leading-loose text-silverfaint">
            PULLED FROM POSH.VIP/G/WECAMETOOPARTY &mdash; titles, dates, times,
            venues, flyer images and the {org.totalEvents} events /{" "}
            {org.totalAttendees.toLocaleString()} attendees totals are real.
            <br />
            STILL NEEDED &mdash; ticket prices, attendee counts for past events,
            a flyer for Mastertripsitter&rsquo;s Birthday BBQ, and copy for the
            two draft dispatches.
            <br />
            NOT REAL YET &mdash; RSVP and accounts are front-end only until
            Supabase is wired up.
          </div>
        </div>
      </section>
    </main>
  );
}
