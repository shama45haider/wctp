import type { Metadata } from "next";
import Link from "next/link";
import TicketsBrowser from "@/components/TicketsBrowser";
import RuntimeEvents from "@/components/RuntimeEvents";
import { upcoming, past, org, monthOf, dayOf } from "@/lib/events";
import { money, priceFrom, saleState, ticketsLeft } from "@/lib/tickets";

export const metadata: Metadata = {
  title: "Tickets · WECAMETOOPARTY",
  description:
    "Every WECAMETOOPARTY date on sale in New York City. Free RSVPs, paid tiers and tables. Every RSVP needs an account with a verified age; the address is emailed to the list before the night.",
};

const onSale = upcoming.filter((e) => saleState(e) === "on-sale");
const nextUp = onSale[0] ?? upcoming[0];
const cheapest = onSale
  .map((e) => priceFrom(e) ?? 0)
  .reduce((a, b) => Math.min(a, b), Infinity);

export default function TicketsPage() {
  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2rem,5vw,4rem)]">
      <header className="mb-8">
        <h1 className="font-display chrome text-[clamp(2.75rem,13vw,7rem)] leading-[0.82]">
          Tickets
        </h1>
        <p className="mt-4 max-w-[46ch] leading-relaxed text-silverdim">
          Every date on sale. Every RSVP, free or paid, needs an account with a
          verified age; paid tiers get you past the line. The address is
          emailed to the list from {org.email} before the night. Nothing is
          held at the door.
        </p>

        {/* Facts strip: wraps to two rows on a phone instead of shrinking. */}
        <dl className="label mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
          <div>
            <dt className="text-silverfaint">ON SALE</dt>
            <dd className="font-display mt-1 text-[1.5rem]">
              {String(onSale.length).padStart(2, "0")}
            </dd>
          </div>
          <div>
            <dt className="text-silverfaint">FROM</dt>
            <dd className="font-display mt-1 text-[1.5rem]">
              {money(Number.isFinite(cheapest) ? cheapest : 0)}
            </dd>
          </div>
          <div>
            <dt className="text-silverfaint">NEXT</dt>
            <dd className="font-display mt-1 text-[1.5rem]">
              {dayOf(nextUp.date)} {monthOf(nextUp.date)}
            </dd>
          </div>
          <div>
            <dt className="text-silverfaint">SPOTS LEFT</dt>
            <dd className="font-display mt-1 text-[1.5rem]">
              {onSale.reduce((n, e) => n + ticketsLeft(e.slug), 0)}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="dot shrink-0" />
          <span className="label text-bloodhi">NEXT UP</span>
          <Link
            href={`/events/${nextUp.slug}#tickets`}
            className="font-display text-[1.6rem] transition-colors hover:text-bloodhi"
          >
            {nextUp.title}
          </Link>
          <Link
            href="/account"
            className="label ml-auto flex min-h-11 items-center border border-linehi px-4 text-silverdim transition-colors hover:border-silverdim hover:text-chalk"
          >
            MY TICKETS &rarr;
          </Link>
        </div>
      </header>

      <TicketsBrowser upcoming={upcoming} past={past} />

      {/* Dates posted from the dashboard since the last deploy. Renders nothing
          at all when there are none, which is most nights - see the component
          for why a database that is down has to look the same as an empty one. */}
      <RuntimeEvents />

      <section className="mt-14 border-t border-line pt-8">
        <h2 className="font-display text-[1.75rem]">How the door works</h2>
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
          ].map((s) => (
            <div key={s.n} className="border border-line p-5">
              <span className="label text-bloodhi">{s.n}</span>
              <h3 className="font-display mt-2 text-[1.35rem]">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-silverdim">
                {s.d}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
