"use client";

import Link from "next/link";
import { useAccount } from "@/lib/demo-account";
import { findEvent, monthOf, dayOf } from "@/lib/events";
import { isPastEvent, usd } from "@/lib/tickets";
import TicketPass from "@/components/TicketPass";
import { btn, btnGo } from "@/lib/ui";

export default function Account() {
  const { ready, user, orders, passCount, signOut, cancelOrder } = useAccount();

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
        <Link href="/login" className={`${btnGo} mt-6`}>
          Go to sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div className="min-w-0">
          <h1 className="font-display chrome text-[clamp(2.25rem,9vw,4.5rem)] leading-[0.85] break-words">
            {user.name}
          </h1>
          <p className="label mt-3 flex flex-wrap gap-x-5 gap-y-1 text-silverfaint">
            <span className="break-all">{user.email.toUpperCase()}</span>
            {user.instagram && <span>{user.instagram.toUpperCase()}</span>}
            <span className={user.verified ? "text-bloodhi" : "text-silverdim"}>
              {user.verified ? "ID VERIFIED" : "ID NOT VERIFIED"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
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

      <div className="mt-8 mb-6 flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-[2rem]">
          Tickets
          <span className="label ml-3 align-middle text-silverfaint">
            {passCount} ACROSS {orders.length}{" "}
            {orders.length === 1 ? "ORDER" : "ORDERS"}
          </span>
        </h2>
        <Link href="/tickets" className="label text-silverdim hover:text-chalk">
          BROWSE DATES &rarr;
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="border border-dashed border-linehi p-8 text-center">
          <p className="text-silverdim">Nothing booked yet.</p>
          <Link href="/tickets" className={`${btnGo} mt-5`}>
            Browse tickets
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {orders.map((o) => {
            const ev = findEvent(o.eventSlug);
            const spent = ev ? isPastEvent(ev) : false;
            return (
              <section key={o.id} className="border border-line bg-ink">
                <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-4 py-4 sm:px-5">
                  <div className="min-w-0">
                    <h3 className="font-display text-[1.5rem] break-words">
                      <Link
                        href={`/events/${o.eventSlug}`}
                        className="hover:text-bloodhi"
                      >
                        {o.eventTitle}
                      </Link>
                    </h3>
                    <p className="label mt-1 flex flex-wrap gap-x-4 gap-y-1 text-silverfaint">
                      <span>ORDER {o.id}</span>
                      {ev && (
                        <span>
                          {ev.dow} {dayOf(ev.date)} {monthOf(ev.date)}
                        </span>
                      )}
                      <span className="text-chalk">
                        {o.totalCents === 0 ? "FREE" : usd(o.totalCents)}
                      </span>
                      {spent && <span>PAST</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => cancelOrder(o.id)}
                    className="label flex min-h-11 items-center border border-line px-4 text-silverfaint transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi"
                  >
                    CANCEL ORDER
                  </button>
                </header>

                <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
                  {o.passes.map((p) => (
                    <TicketPass
                      key={p.code}
                      pass={p}
                      eventSlug={o.eventSlug}
                      eventTitle={o.eventTitle}
                      orderId={o.id}
                    />
                  ))}
                </div>

                {o.discountCents > 0 && (
                  <p className="label border-t border-line px-4 py-3 text-silverfaint sm:px-5">
                    {o.promoCode} APPLIED · SAVED {usd(o.discountCents)}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="label mt-10 border-t border-line pt-5 leading-loose text-silverfaint">
        TICKETS LIVE IN THIS BROWSER ONLY. CLEARING SITE DATA CLEARS THEM.
      </p>

      <Link href="/tickets" className={`${btn} mt-6`}>
        Back to tickets
      </Link>
    </main>
  );
}
