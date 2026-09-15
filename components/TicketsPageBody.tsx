"use client";

import TicketsBrowser from "./TicketsBrowser";
import TicketsHeader from "./TicketsHeader";
import RuntimeEvents from "./RuntimeEvents";
import { Editable } from "./Editable";
import { org } from "@/lib/events";
import { useRuntimeEvents } from "@/lib/events-runtime";

/**
 * Everything on /tickets: calls useRuntimeEvents once and hands the same
 * answer to TicketsHeader, TicketsBrowser and RuntimeEvents, so the next-up
 * line, the browsable grid and the "just announced" section can never
 * disagree with each other, and the dashboard's events table is read once
 * per visit rather than once per component that wants it.
 *
 * A client component for that one reason - the hook needs a browser to ask
 * what day it actually is (see lib/now.ts) and to fetch from Supabase - so
 * the static intro copy and the fully static "how the door works" section
 * live here too rather than staying behind in app/tickets/page.tsx, which
 * keeps only the page metadata a client component cannot export.
 */
export default function TicketsPageBody({ pageSlugs }: { pageSlugs: string[] }) {
  // Which dates have a page to link to - see lib/share-events.ts.
  const runtime = useRuntimeEvents(pageSlugs);

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2rem,5vw,4rem)]">
      <header className="mb-8">
        <h1 className="font-display chrome text-[clamp(2.75rem,13vw,7rem)] leading-[0.82]">
          <Editable k="tickets.title">Tickets</Editable>
        </h1>
        <p className="mt-4 max-w-[46ch] leading-relaxed text-silverdim">
          <Editable k="tickets.intro">
            {`Every date on sale. Every RSVP, free or paid, needs an account with a verified age; paid tiers get you past the line. The address is emailed to the list from ${org.email} before the night. Nothing is held at the door.`}
          </Editable>
        </p>

        <TicketsHeader runtime={runtime} />
      </header>

      <TicketsBrowser runtime={runtime} />

      {/* Dates posted from the dashboard since the last deploy. Renders nothing
          at all when there are none, which is most nights - see the component
          for why a database that is down has to look the same as an empty one. */}
      <RuntimeEvents runtime={runtime} />

      <section className="mt-14 border-t border-line pt-8">
        <h2 className="font-display text-[1.75rem]">
          <Editable k="tickets.how.title">How the door works</Editable>
        </h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              n: "01",
              t: "Verify your age once",
              d: `Make an account and send a photo of your ID. A person reads it, so give it time, and you hear back from ${org.email}. After that you are clear for every date.`,
            },
            {
              n: "02",
              t: "Book a spot",
              d: "Pick a tier and check out. Free RSVPs still need a ticket - that is how the count stays honest.",
            },
            {
              n: "03",
              t: "Get the address",
              d: `Emailed from ${org.email} to the email on your account before the night. Watch the feed too.`,
            },
            {
              n: "04",
              t: "Scan and walk in",
              d: `Show the QR from your account. 18+ with ID, no exceptions. ${org.instagramHandle} for anything else.`,
            },
          ].map((s, i) => (
            <div key={s.n} className="border border-line p-5">
              <span className="label text-bloodhi">{s.n}</span>
              <h3 className="font-display mt-2 text-[1.35rem]">
                <Editable k={`tickets.how.${i}.title`}>{s.t}</Editable>
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-silverdim">
                <Editable k={`tickets.how.${i}.body`}>{s.d}</Editable>
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
