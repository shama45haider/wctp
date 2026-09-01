"use client";

import Link from "next/link";
import { useAccount, money } from "@/lib/demo-account";
import { findEvent, monthOf, dayOf } from "@/lib/events";
import TicketQr from "@/components/TicketQr";

export default function Account() {
  const { ready, user, tickets, signOut, cancelTicket } = useAccount();

  if (!ready) {
    return (
      <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
        <p className="label text-silverfaint">LOADING&hellip;</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(2.5rem,7vw,5rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,6vw,3rem)]">
          Not signed in
        </h1>
        <p className="mt-3 text-silverdim">
          Sign in to see your tickets, or look around with the demo guest.
        </p>
        <Link
          href="/login"
          className="font-display mt-6 inline-block border border-[rgba(200,16,46,0.5)] px-6 py-3 tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div>
          <h1 className="font-display chrome text-[clamp(2.25rem,7vw,4.5rem)] leading-[0.85]">
            {user.name}
          </h1>
          <p className="label mt-3 flex flex-wrap gap-x-5 gap-y-1 text-silverfaint">
            <span>{user.email.toUpperCase()}</span>
            {user.instagram && <span>{user.instagram.toUpperCase()}</span>}
            <span className={user.verified ? "text-bloodhi" : "text-silverdim"}>
              {user.verified ? "ID VERIFIED" : "ID NOT VERIFIED"}
            </span>
          </p>
        </div>
        <div className="flex gap-3">
          {!user.verified && (
            <Link
              href="/verify"
              className="label flex min-h-11 items-center border border-[rgba(200,16,46,0.5)] px-4 text-chalk hover:border-bloodhi"
            >
              VERIFY ID
            </Link>
          )}
          <button
            onClick={signOut}
            className="label flex min-h-11 items-center border border-linehi px-4 text-silverdim transition-colors hover:border-silverdim hover:text-chalk"
          >
            SIGN OUT
          </button>
        </div>
      </div>

      <h2 className="font-display mt-10 mb-5 text-[2rem]">
        Tickets
        <span className="label ml-3 align-middle text-silverfaint">
          {tickets.length}
        </span>
      </h2>

      {tickets.length === 0 ? (
        <div className="border border-dashed border-linehi p-8 text-center">
          <p className="text-silverdim">Nothing booked yet.</p>
          <Link
            href="/#events"
            className="font-display mt-5 inline-block border border-[rgba(200,16,46,0.5)] px-6 py-3 tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
          >
            Browse events
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.map((t) => {
            const ev = findEvent(t.eventSlug);
            return (
              <article
                key={t.code}
                className="flex flex-col border border-line bg-ink"
              >
                <div className="label flex justify-between border-b border-dashed border-linehi px-5 py-3 text-silverfaint">
                  <span>
                    {ev ? `${ev.dow} ${dayOf(ev.date)} ${monthOf(ev.date)}` : ""}
                  </span>
                  <span className="text-bloodhi">
                    {t.paidCents > 0 ? money(t.paidCents) : "FREE"}
                  </span>
                </div>
                <div className="flex-1 px-5 py-5">
                  <h3 className="font-display text-[1.5rem]">
                    <Link
                      href={`/events/${t.eventSlug}`}
                      className="hover:text-bloodhi"
                    >
                      {t.eventTitle}
                    </Link>
                  </h3>
                  {ev && (
                    <p className="label mt-1 text-silverdim">
                      {ev.venue.toUpperCase()} · {ev.time}
                    </p>
                  )}
                  <div className="mt-4 border-t border-dashed border-linehi pt-5">
                    <TicketQr code={t.code} size={132} />
                  </div>
                  <p className="label mt-3 text-center text-silverfaint">
                    {t.guests === 1 ? "1 SPOT" : `${t.guests} SPOTS`}
                  </p>
                </div>
                <button
                  onClick={() => cancelTicket(t.code)}
                  className="label min-h-11 border-t border-line py-3 text-silverfaint transition-colors hover:bg-[rgba(200,16,46,0.08)] hover:text-bloodhi"
                >
                  CANCEL RSVP
                </button>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
