"use client";

import Link from "next/link";
import EventLink from "./EventLink";
import EventManifest from "./EventManifest";
import Flyer from "./Flyer";
import { Editable } from "./Editable";
import { org, monthOf, dayOf } from "@/lib/events";
import { useRuntimeEvents } from "@/lib/events-runtime";
import { poshRsvpFor } from "@/lib/tickets";

/**
 * Everything on the home page that depends on which night is next.
 *
 * lib/events.ts still ships two hand-sorted arrays, `upcoming` and `past`,
 * but this no longer reads them directly - a date in `upcoming` only stays
 * there because nobody has told the site otherwise, and the site itself has
 * no server to notice a date passing on its own. useRuntimeEvents does that
 * noticing: it re-splits every known event, static and dashboard-posted
 * alike, against the real clock (see lib/now.ts), so a night that has
 * happened falls out of "Upcoming" and into "Archive" by itself, and
 * whichever night is genuinely soonest becomes "NEXT" - here, and nowhere
 * else that still has to be remembered and edited by hand.
 *
 * The very first render uses the same build-time ordering the static export
 * always has, because useRuntimeEvents seeds itself that way before its own
 * clock correction lands - so hydration has nothing to disagree with, and
 * this component only ever visibly changes after that first paint, the
 * moment the visitor's own browser says what day it actually is.
 */

function SectionHead({
  title,
  blurb,
  aside,
}: {
  title: React.ReactNode;
  blurb?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-10 flex flex-col items-start gap-3 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div>
        <h2 className="font-display chrome text-[clamp(2.5rem,6vw,4.5rem)]">
          {title}
        </h2>
        {blurb && <p className="mt-2 max-w-[42ch] text-silverdim">{blurb}</p>}
      </div>
      {aside && (
        <div className="label text-silverfaint sm:shrink-0">{aside}</div>
      )}
    </div>
  );
}

const GET_TICKETS =
  "label flex min-h-11 w-full shrink-0 items-center justify-center border border-[rgba(200,16,46,0.5)] px-4 text-chalk transition-all hover:border-bloodhi hover:bg-[rgba(200,16,46,0.08)] sm:ml-auto sm:w-auto";

export default function HomeContent({ pageSlugs }: { pageSlugs: string[] }) {
  // hasPage: a date published since the last build is listed, but has no page
  // to link to yet - see components/EventLink.tsx.
  const { upcoming, past, hasPage } = useRuntimeEvents(pageSlugs);
  const next = upcoming[0] as (typeof upcoming)[number] | undefined;
  const nextHasPage = next ? hasPage(next.slug) : false;
  // A date whose RSVP is on Posh sends GET TICKETS there - see lib/tickets.ts.
  const nextPosh = next ? poshRsvpFor(next.slug) : null;

  return (
    <main>
      <header className="relative overflow-hidden border-b border-line">
        {/* stamped index strip */}
        <div className="border-b border-line">
          <div className="label mx-auto flex w-[92vw] max-w-[1180px] justify-between py-2 text-silverfaint">
            <span>
              <Editable k="home.strip.est">EST. NYC</Editable>
            </span>
            <span>
              {org.totalEvents} / {org.totalAttendees.toLocaleString()}
              <span className="hidden sm:inline">
                {" "}
                <Editable k="home.strip.heads">HEADS</Editable>
              </span>
            </span>
            <span>
              <Editable k="home.strip.age">18+</Editable>
            </span>
          </div>
        </div>

        <div className="mx-auto grid w-[92vw] max-w-[1180px] grid-cols-1 items-end gap-x-8 pt-8 pb-7 md:grid-cols-[1fr_auto]">
          <div className="relative z-10">
            <h1 className="font-display text-[clamp(2.75rem,10.5vw,7.5rem)] leading-[0.78] tracking-[-0.03em]">
              <span className="chrome block">
                <Editable k="home.hero.line1">WE CAME</Editable>
              </span>
              <span className="text-outline block">
                <Editable k="home.hero.line2">TOO PARTY</Editable>
              </span>
            </h1>

            <p className="mt-5 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
              <Editable k="home.hero.bio">{org.bio}</Editable>
            </p>

            {/* Next-up strip. Centred as a stack on a phone, where the pieces
                wrap onto four ragged lines if they stay left-aligned; from sm
                it is the single row the desktop layout expects. Every date
                that has ever shipped eventually passes, so this has to say
                something even once `upcoming` runs dry rather than reading
                past a slug that no longer leads anywhere. */}
            {next ? (
              <div className="mt-6 flex flex-col items-center gap-3 border-t border-line pt-4 text-center sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 sm:text-left">
                <span className="flex items-center gap-2">
                  <span className="dot shrink-0" />
                  <span className="label text-bloodhi">
                    <Editable k="home.next.label">NEXT</Editable>
                  </span>
                </span>
                {/* Padded to a thumb and pulled back with a matching negative
                    margin, so the strip keeps its spacing while the headline
                    stops being a 26px tap target on the busiest link here. */}
                <EventLink
                  slug={next.slug}
                  hasPage={nextHasPage}
                  className="font-display -my-2.5 inline-block py-2.5 text-[1.75rem] leading-none transition-colors hover:text-bloodhi"
                >
                  {next.title}
                </EventLink>
                <span className="label text-silverdim">
                  {next.dow} {dayOf(next.date)} {monthOf(next.date)}
                  &nbsp;/&nbsp;{next.time}&nbsp;/&nbsp;
                  <Editable k="home.next.address">ADDRESS BY EMAIL</Editable>
                </span>
                {nextPosh ? (
                  <a href={nextPosh} className={GET_TICKETS}>
                    GET TICKETS &rarr;
                  </a>
                ) : (
                  nextHasPage && (
                    <Link
                      href={`/events/${next.slug}#tickets`}
                      className={GET_TICKETS}
                    >
                      GET TICKETS &rarr;
                    </Link>
                  )
                )}
              </div>
            ) : (
              <div className="mt-6 border-t border-line pt-4 text-center sm:text-left">
                <span className="label text-silverfaint">
                  <Editable k="home.next.none">
                    {`NOTHING ON SALE RIGHT NOW - WATCH ${org.instagramHandle.toUpperCase()} FOR THE NEXT ONE`}
                  </Editable>
                </span>
              </div>
            )}
          </div>

          {/* Tilted flyer stack, md and up only. On a phone it sat above the
              headline and pushed the name and the next date below the fold;
              the flyer is one tap away in the strip underneath, and the
              headline is what the top of the page is for. Hidden entirely
              with no next date - a stack with nothing to tilt is just a
              hole in the layout - and falls back to a plain "no flyer" box
              rather than a broken image if the next date has none. */}
          {next && (
            <div className="relative hidden shrink-0 md:block md:w-[clamp(190px,22vw,270px)]">
              <div className="absolute -top-3 -right-3 aspect-[4/5] w-full rotate-[5deg] border border-line bg-ink" />
              <EventLink
                slug={next.slug}
                hash="tickets"
                hasPage={nextHasPage}
                className="scanlines group relative block aspect-[4/5] w-full -rotate-[2deg] overflow-hidden border border-linehi shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] transition-transform hover:rotate-0"
              >
                {next.imageId ? (
                  <Flyer
                    id={next.imageId}
                    alt={next.title}
                    sizes="(max-width:767px) 58vw, 270px"
                    maxWidth={640}
                    priority
                    className="contrast-[1.1] saturate-[0.85]"
                  />
                ) : (
                  <div className="label flex h-full items-center justify-center bg-ink2 text-silverfaint">
                    NO FLYER
                  </div>
                )}
                <span className="label absolute bottom-0 left-0 bg-void/85 px-2 py-1 text-bloodhi">
                  ON SALE
                </span>
              </EventLink>
            </div>
          )}
        </div>

        {/* marquee */}
        {upcoming.length > 0 && (
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
        )}
      </header>

      <section id="events" className="py-[clamp(3.5rem,7vw,6rem)]">
        <div className="mx-auto w-[92vw] max-w-[1180px]">
          <SectionHead
            title={<Editable k="home.upcoming.title">Upcoming</Editable>}
            aside={
              <>
                {String(upcoming.length).padStart(2, "0")}{" "}
                <Editable k="home.upcoming.datesLabel">DATES</Editable>
              </>
            }
          />
          {upcoming.length > 0 ? (
            <EventManifest events={upcoming} hasPage={hasPage} />
          ) : (
            <div className="border border-dashed border-linehi p-10 text-center">
              <p className="font-display text-2xl">
                <Editable k="home.upcoming.emptyTitle">Nothing on sale yet</Editable>
              </p>
              <p className="mt-2 text-sm text-silverdim">
                <Editable k="home.upcoming.emptyBlurb">
                  {`The next date drops on ${org.instagramHandle} first.`}
                </Editable>
              </p>
            </div>
          )}
          <Link
            href="/tickets"
            className="label mt-6 flex min-h-11 items-center justify-center border border-linehi text-silverdim transition-colors hover:border-silverdim hover:text-chalk"
          >
            ALL DATES, PRICES AND TIERS &rarr;
          </Link>
        </div>
      </section>

      {/* content-visibility: the archive is the longest stretch of the page
          and starts below the fold, so the browser skips laying it out until
          it is scrolled near. */}
      <section
        id="archive"
        className="py-[clamp(3.5rem,7vw,6rem)] [contain-intrinsic-size:auto_2400px] [content-visibility:auto]"
      >
        <div className="mx-auto w-[92vw] max-w-[1180px]">
          <SectionHead
            title={<Editable k="home.archive.title">Archive</Editable>}
            blurb={
              <Editable k="home.archive.blurb">
                Everything we&rsquo;ve thrown. Nothing gets taken down.
              </Editable>
            }
            aside={
              <>
                {org.totalEvents} <Editable k="home.archive.eventsLabel">EVENTS</Editable>
                {" · "}
                {org.totalAttendees.toLocaleString()}{" "}
                <Editable k="home.archive.attendeesLabel">ATTENDEES</Editable>
              </>
            }
          />
          {/* Two-up on a phone: a portrait flyer squeezed into one full-width
              180px band loses most of the artwork, which is the whole point of
              an archive. Paired columns show each flyer whole. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(230px,1fr))] sm:gap-5">
            {past.map((e) => (
              <EventLink
                key={e.slug}
                slug={e.slug}
                hasPage={hasPage(e.slug)}
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
                    {e.dow} {dayOf(e.date)} {monthOf(e.date)} &middot; {e.time}
                  </span>
                </div>
              </EventLink>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
