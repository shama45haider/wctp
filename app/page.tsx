import Link from "next/link";
import EventManifest from "@/components/EventManifest";
import Flyer from "@/components/Flyer";
import { upcoming, past, org, monthOf, dayOf } from "@/lib/events";
import { getInstagramPosts } from "@/lib/instagram";

const next = upcoming[0];
const posts = getInstagramPosts();

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
    <div className="mb-10 flex flex-col items-start gap-3 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div>
        <h2 className="font-display chrome text-[clamp(2.5rem,6vw,4.5rem)]">
          {title}
        </h2>
        <p className="mt-2 max-w-[42ch] text-silverdim">{blurb}</p>
      </div>
      {aside && (
        <div className="label text-silverfaint sm:shrink-0">{aside}</div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <header className="relative overflow-hidden border-b border-line">
        {/* stamped index strip */}
        <div className="border-b border-line">
          <div className="label mx-auto flex w-[92vw] max-w-[1180px] justify-between py-2 text-silverfaint">
            <span>EST. NYC</span>
            <span>
              {org.totalEvents} / {org.totalAttendees.toLocaleString()}
              <span className="hidden sm:inline"> HEADS</span>
            </span>
            <span>18+</span>
          </div>
        </div>

        <div className="mx-auto grid w-[92vw] max-w-[1180px] grid-cols-1 items-end gap-x-8 pt-8 pb-7 md:grid-cols-[1fr_auto]">
          <div className="relative z-10">
            <h1 className="font-display text-[clamp(2.75rem,10.5vw,7.5rem)] leading-[0.78] tracking-[-0.03em]">
              <span className="chrome block">WE CAME</span>
              <span className="text-outline block">TOO PARTY</span>
            </h1>

            <p className="mt-5 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
              {org.bio}
            </p>

            {/* Next-up strip. Centred as a stack on a phone, where the pieces
                wrap onto four ragged lines if they stay left-aligned; from sm
                it is the single row the desktop layout expects. */}
            <div className="mt-6 flex flex-col items-center gap-3 border-t border-line pt-4 text-center sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 sm:text-left">
              <span className="flex items-center gap-2">
                <span className="dot shrink-0" />
                <span className="label text-bloodhi">NEXT</span>
              </span>
              <Link
                href={`/events/${next.slug}`}
                className="font-display text-[1.75rem] leading-none transition-colors hover:text-bloodhi"
              >
                {next.title}
              </Link>
              <span className="label text-silverdim">
                {next.dow} {dayOf(next.date)} {monthOf(next.date)}
                &nbsp;/&nbsp;{next.time}&nbsp;/&nbsp;
                {next.venue.toUpperCase()}
              </span>
              <Link
                href={`/events/${next.slug}#tickets`}
                className="label flex min-h-11 w-full shrink-0 items-center justify-center border border-[rgba(200,16,46,0.5)] px-4 text-chalk transition-all hover:border-bloodhi hover:bg-[rgba(200,16,46,0.08)] sm:ml-auto sm:w-auto"
              >
                GET TICKETS &rarr;
              </Link>
            </div>
          </div>

          {/* Tilted flyer stack, md and up only. On a phone it sat above the
              headline and pushed the name and the next date below the fold;
              the flyer is one tap away in the strip underneath, and the
              headline is what the top of the page is for. */}
          <div className="relative hidden shrink-0 md:block md:w-[clamp(190px,22vw,270px)]">
            <div className="absolute -top-3 -right-3 aspect-[4/5] w-full rotate-[5deg] border border-line bg-ink" />
            <Link
              href={`/events/${next.slug}#tickets`}
              className="scanlines group relative block aspect-[4/5] w-full -rotate-[2deg] overflow-hidden border border-linehi shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] transition-transform hover:rotate-0"
            >
              <Flyer
                id={next.imageId!}
                alt={next.title}
                sizes="(max-width:767px) 58vw, 270px"
                maxWidth={640}
                priority
                className="contrast-[1.1] saturate-[0.85]"
              />
              <span className="label absolute bottom-0 left-0 bg-void/85 px-2 py-1 text-bloodhi">
                ON SALE
              </span>
            </Link>
          </div>
        </div>

        {/* marquee */}
        <div className="overflow-hidden border-t border-line py-2.5">
          <div className="marquee-track">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex shrink-0" aria-hidden={dup === 1}>
                {upcoming.map((e) => (
                  <span
                    key={e.slug}
                    className="label flex items-center gap-4 px-5 text-silverfaint whitespace-nowrap"
                  >
                    <span className="text-silver">{e.title.toUpperCase()}</span>
                    <span>
                      {dayOf(e.date)}.{e.date.slice(5, 7)}
                    </span>
                    <span className="hairline-x h-2 w-2 shrink-0" />
                  </span>
                ))}
              </div>
            ))}
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
          <Link
            href="/tickets"
            className="label mt-6 flex min-h-11 items-center justify-center border border-linehi text-silverdim transition-colors hover:border-silverdim hover:text-chalk"
          >
            ALL DATES, PRICES AND TIERS &rarr;
          </Link>
        </div>
      </section>

      <section id="instagram" className="py-[clamp(3.5rem,7vw,6rem)]">
        <div className="mx-auto w-[92vw] max-w-[1180px]">
          <SectionHead
            title="Official Instagram"
            blurb={`Every post from ${org.instagramHandle}, straight from the account.`}
            aside={posts.length ? `${posts.length} POSTS` : undefined}
          />

          {posts.length > 0 ? (
            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
              {posts.map((p) => (
                <a
                  key={p.id}
                  href={p.permalink}
                  target="_blank"
                  rel="noopener"
                  className="group relative aspect-square overflow-hidden bg-void"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnailUrl ?? p.mediaUrl}
                    alt={p.caption?.slice(0, 120) ?? "Instagram post"}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover grayscale-[0.35] transition-[filter,transform] duration-500 group-hover:scale-[1.03] group-hover:grayscale-0"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-[rgba(5,5,5,0.9)] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  {p.caption && (
                    <span className="label absolute right-3 bottom-3 left-3 line-clamp-3 text-silver opacity-0 transition-opacity group-hover:opacity-100">
                      {p.caption}
                    </span>
                  )}
                  {p.mediaType === "VIDEO" && (
                    <span className="label absolute top-2 right-2 bg-void/80 px-1.5 py-0.5 text-bloodhi">
                      REEL
                    </span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <div className="border border-line">
              <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="hairline-x aspect-square bg-void opacity-30"
                  />
                ))}
              </div>
              <div className="label flex flex-wrap items-center justify-between gap-4 border-t border-line p-5 text-silverfaint">
                <span>NEW POSTS DROP HERE</span>
                <a
                  href={org.instagram}
                  target="_blank"
                  rel="noopener"
                  className="border border-linehi px-3 py-2 text-silver transition-colors hover:border-bloodhi hover:text-bloodhi"
                >
                  FOLLOW {org.instagramHandle.toUpperCase()} &rarr;
                </a>
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="archive" className="py-[clamp(3.5rem,7vw,6rem)]">
        <div className="mx-auto w-[92vw] max-w-[1180px]">
          <SectionHead
            title="Archive"
            blurb="Everything we&rsquo;ve thrown. Nothing gets taken down."
            aside={`${org.totalEvents} EVENTS · ${org.totalAttendees.toLocaleString()} ATTENDEES`}
          />
          {/* Two-up on a phone: a portrait flyer squeezed into one full-width
              180px band loses most of the artwork, which is the whole point of
              an archive. Paired columns show each flyer whole. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(230px,1fr))] sm:gap-5">
            {past.map((e) => (
                <Link
                  key={e.slug}
                  href={`/events/${e.slug}`}
                  className="group border border-line bg-ink transition-colors hover:border-linehi"
                >
                  <div className="relative aspect-[4/5] overflow-hidden sm:aspect-auto sm:h-[180px]">
                    {e.imageId ? (
                      <Flyer
                        id={e.imageId}
                        alt={e.title}
                        sizes="(max-width:639px) 45vw, (max-width:1023px) 46vw, 280px"
                        maxWidth={640}
                        className="grayscale transition-[filter] duration-500 group-hover:grayscale-[0.5]"
                      />
                    ) : (
                      <div className="label flex h-full items-center justify-center bg-ink2 text-silverfaint">
                        NO FLYER
                      </div>
                    )}
                    <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(5,5,5,0.85)]" />
                  </div>
                  <div className="px-4 pt-3 pb-5 sm:px-5 sm:pt-4 sm:pb-6">
                    <h3 className="font-display text-[1.15rem] break-words sm:text-[1.4rem]">
                      {e.title}
                    </h3>
                    <span className="label mt-2 block text-silverfaint">
                      {e.dow} {dayOf(e.date)} {monthOf(e.date)} &middot;{" "}
                      {e.venue.toUpperCase()}
                    </span>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </section>
    </main>
  );
}
