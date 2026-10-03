"use client";

import Link from "next/link";
import EventLink from "./EventLink";
import Flyer from "./Flyer";
import PoshLink from "./PoshLink";
import { Editable } from "./Editable";
import Logo from "./Logo";
import { heroPhoto, org, monthOf, dayOf } from "@/lib/events";
import { useRuntimeEvents } from "@/lib/events-runtime";
import EventCarousel from "./EventCarousel";
import DeleteEventButton from "./DeleteEventButton";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { poshRsvpFor } from "@/lib/tickets";
import { btn, btnBase } from "@/lib/ui";

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
        <h2 className="font-display chrome text-[clamp(2.5rem,6vw,4.5rem)]">{title}</h2>
        {blurb && <p className="mt-2 max-w-[42ch] text-silverdim">{blurb}</p>}
      </div>
      {aside && <div className="label text-silverfaint sm:shrink-0">{aside}</div>}
    </div>
  );
}

/**
 * The paste-up wall, left to right: which pick hangs in each spot and how.
 * Pick 0 - the next date - is the middle and biggest; the rest fan outwards
 * in the order they come. A phone shows the middle three, md five, lg seven.
 * Each poster's z-index rises towards the middle so the lead sits on top.
 */
const WALL = [
  { pick: 5, className: "z-0 hidden w-[12vw] max-w-[11rem] -rotate-[5deg] translate-y-6 lg:block" },
  { pick: 3, className: "z-[1] hidden w-[17vw] max-w-[12.5rem] rotate-[5deg] -translate-y-3 md:block lg:w-[14vw]" },
  { pick: 1, className: "z-[2] w-[33vw] max-w-[15.5rem] -rotate-[4deg] translate-y-3 md:w-[22vw] lg:w-[17vw]" },
  { pick: 0, className: "z-[3] w-[50vw] max-w-[20rem] rotate-[2deg] md:w-[30vw] lg:w-[22vw]" },
  { pick: 2, className: "z-[2] w-[33vw] max-w-[15.5rem] rotate-[6deg] -translate-y-2 md:w-[22vw] lg:w-[17vw]" },
  { pick: 4, className: "z-[1] hidden w-[17vw] max-w-[12.5rem] -rotate-[3deg] translate-y-4 md:block lg:w-[14vw]" },
  { pick: 6, className: "z-0 hidden w-[12vw] max-w-[11rem] rotate-[7deg] -translate-y-4 lg:block" },
] as const;

/** The hero's one loud button: solid blood, the only filled red on the page. */
const HERO_CTA = `${btnBase} border border-bloodhi bg-blood text-chalk hover:bg-bloodhi hover:shadow-[0_12px_36px_-12px_rgba(232,33,63,0.75)] flex-[1.6] md:flex-none`;

export default function HomeContent({ pageSlugs }: { pageSlugs: string[] }) {
  // hasPage: a date published since the last build is listed, but has no page
  // to link to yet - see components/EventLink.tsx.
  const { upcoming, past, hasPage, hide } = useRuntimeEvents(pageSlugs);
  // Delete controls on every flyer, for an admin only. Waits on `ready` so a
  // guest never sees one flash past while the session resolves; the delete
  // itself is refused by row-level security for anyone else regardless.
  const { ready, isAdmin } = useSupabaseAuth();
  const onDelete = ready && isAdmin ? hide : undefined;
  const next = upcoming[0] as (typeof upcoming)[number] | undefined;
  const nextHasPage = next ? hasPage(next.slug) : false;
  // A date whose RSVP is on Posh sends GET TICKETS there - see lib/tickets.ts.
  const nextPosh = next ? poshRsvpFor(next.slug) : null;
  // The wall: every date with a flyer, coming ones first, so the next night
  // takes the middle and the archive fills the edges once the calendar thins.
  const wall = [...upcoming, ...past].filter((e) => heroPhoto(e) || e.imageId).slice(0, WALL.length);

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

        {/* The hero is a wall of paste-ups: the coming nights' flyers stuck
            up edge to edge, overlapping and leaning, the next one biggest in
            the middle, and the logo slapped over the corner as a sticker.
            Pinned over the bottom of the wall, the next date as a ticket,
            torn stub and all. */}
        {wall.length > 0 ? (
          <div className="paste-wall relative overflow-hidden">
            <div className="flex items-center justify-center py-[clamp(1.75rem,4vw,3rem)]">
              {WALL.map(({ pick, className }) => {
                const e = wall[pick];
                if (!e) return null;
                const lead = pick === 0 && e.slug === next?.slug;
                return (
                  <EventLink
                    key={e.slug}
                    slug={e.slug}
                    hash={lead ? "tickets" : undefined}
                    hasPage={hasPage(e.slug)}
                    className={`relative -mx-[2vw] block shrink-0 transition-[rotate,translate] duration-300 hover:z-20 hover:-translate-y-2 hover:rotate-0 md:-mx-[1.1vw] ${className}`}
                  >
                    <span className="relative block aspect-[4/5] overflow-hidden border border-black/70 shadow-[0_22px_48px_-16px_rgba(0,0,0,0.95)]">
                      <Flyer
                        id={e.imageId}
                        src={heroPhoto(e) ?? undefined}
                        alt={e.title}
                        sizes={pick === 0 ? "(max-width:767px) 50vw, 22vw" : "(max-width:767px) 33vw, 17vw"}
                        maxWidth={pick === 0 ? 640 : 400}
                        priority={pick < 3}
                        className="contrast-[1.08]"
                      />
                      {lead && (
                        <span className="label absolute bottom-0 left-0 bg-blood px-2 py-1 text-chalk">
                          <Editable k="home.next.label">NEXT</Editable>
                        </span>
                      )}
                    </span>
                    <span aria-hidden className="poster-tape left-[14%] -rotate-[8deg]" />
                    <span aria-hidden className="poster-tape right-[12%] rotate-[6deg]" />
                  </EventLink>
                );
              })}
            </div>

            {/* The red halftone logo, stuck on like a sticker - the home
                page's own finish; the nav wears the clean one. */}
            <h1 className="absolute top-[clamp(0.75rem,2.5vw,1.75rem)] left-[3vw] z-30 w-[clamp(5rem,13vw,9rem)] -rotate-[10deg] rounded-[22%] border-[3px] border-chalk bg-void p-[clamp(0.45rem,1.1vw,0.75rem)] shadow-[0_18px_36px_-12px_rgba(0,0,0,0.95)]">
              <Logo finish="red-halftone" eager className="h-auto w-full" />
            </h1>
          </div>
        ) : (
          <h1 className="mx-auto w-[clamp(7rem,30vw,10rem)] pt-8">
            <Logo finish="red-halftone" eager className="h-auto w-full" />
          </h1>
        )}

        <div className="relative z-10 mx-auto w-[92vw] max-w-[1180px] pb-[clamp(1.5rem,3.5vw,2.5rem)]">
          {/* Every date that has ever shipped eventually passes, so this has
              to say something even once `upcoming` runs dry rather than
              reading past a slug that no longer leads anywhere. */}
          {next ? (
            <div
              className={`grid border border-linehi bg-ink shadow-[0_24px_50px_-24px_rgba(0,0,0,0.95)] md:grid-cols-[minmax(0,1fr)_auto] ${
                wall.length > 0 ? "-mt-[clamp(1.25rem,3vw,2rem)]" : "mt-6"
              }`}
            >
              <div className="min-w-0 px-4 py-4 sm:px-6 sm:py-5">
                <p className="label flex items-center gap-2">
                  <span className="dot shrink-0" />
                  <span className="text-bloodhi">ADMIT ONE</span>
                </p>
                <EventLink
                  slug={next.slug}
                  hasPage={nextHasPage}
                  className="font-display chrome mt-2 block text-[clamp(1.75rem,5vw,3.25rem)] leading-[0.9] break-words uppercase transition-opacity hover:opacity-80"
                >
                  {next.title}
                </EventLink>
                <p className="label mt-2 text-silverdim">
                  {next.dow} {dayOf(next.date)} {monthOf(next.date)}
                  &nbsp;/&nbsp;{next.time}&nbsp;/&nbsp;
                  <Editable k="home.next.address">ADDRESS BY EMAIL</Editable>
                </p>
              </div>
              <div className="ticket-stub flex items-center gap-3 border-t border-dashed border-linehi px-4 py-4 sm:px-6 md:border-t-0 md:border-l">
                {nextPosh ? (
                  <PoshLink href={nextPosh} className={HERO_CTA}>
                    GET TICKETS &rarr;
                  </PoshLink>
                ) : (
                  nextHasPage && (
                    <Link href={`/events/${next.slug}#tickets`} className={HERO_CTA}>
                      GET TICKETS &rarr;
                    </Link>
                  )
                )}
                <a href="#events" className={`${btn} flex-1 md:flex-none`}>
                  ALL DATES
                </a>
              </div>
            </div>
          ) : (
            <p className="label mt-6 border border-line px-4 py-4 text-center text-silverfaint">
              <Editable k="home.next.none">
                {`NOTHING ON SALE RIGHT NOW - WATCH ${org.instagramHandle.toUpperCase()} FOR THE NEXT ONE`}
              </Editable>
            </p>
          )}

          <p className="mt-4 text-[0.875rem] leading-relaxed text-silverdim">
            <Editable k="home.hero.bio">{org.bio}</Editable>
          </p>
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

      <section id="events" className="overflow-x-clip py-[clamp(3.5rem,7vw,6rem)]">
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
            <EventCarousel events={upcoming} hasPage={hasPage} onDelete={onDelete} />
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
              <div key={e.slug} className="relative flex">
                <EventLink
                  slug={e.slug}
                  hasPage={hasPage(e.slug)}
                  className="group w-full border border-line bg-ink transition-colors hover:border-linehi"
                >
                  <div className="relative aspect-[4/5] overflow-hidden sm:aspect-auto sm:h-[180px]">
                    {heroPhoto(e) || e.imageId ? (
                      <Flyer
                        id={e.imageId}
                        src={heroPhoto(e) ?? undefined}
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
                {onDelete && (
                  <DeleteEventButton slug={e.slug} title={e.title} onDeleted={onDelete} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
