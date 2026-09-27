"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/lib/demo-account";
import { confirmTicketPayment } from "@/lib/ticket-checkout";
import { findEvent, monthOf, dayOf } from "@/lib/events";
import { atHandle } from "@/lib/handle";
import { useNow } from "@/lib/now";
import { isPastEvent, usd } from "@/lib/tickets";
import TicketPass from "@/components/TicketPass";
import AttendedEvents from "@/components/AttendedEvents";
import XpPanel from "@/components/XpPanel";
import FriendsPanel from "@/components/FriendsPanel";
import SongRequests from "@/components/SongRequests";
import MyPrizes from "@/components/MyPrizes";
import { Editable } from "@/components/Editable";
import { btn, btnGo } from "@/lib/ui";

/**
 * Back from Stripe: /account?paid=tickets&session_id=cs_...
 *
 * Confirms the payment with ticket-order-status, which records the order if
 * the webhook has not already, then re-reads the orders so the tickets are on
 * screen. The query is stripped afterwards so a reload does not repeat it.
 */
function usePaymentReturn(
  signedIn: boolean,
  reloadOrders: () => void,
  clearCart: () => void,
) {
  const [state, setState] = useState<
    { kind: "working" } | { kind: "done" } | { kind: "error"; text: string } | null
  >(null);
  const started = useRef(false);

  useEffect(() => {
    if (!signedIn || started.current) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("paid") !== "tickets" || !sessionId) return;
    started.current = true;
    let live = true;

    void (async () => {
      setState({ kind: "working" });
      // The webhook and this call race; a couple of tries covers Stripe being
      // a beat behind on marking the session paid.
      let out = await confirmTicketPayment(sessionId);
      for (let i = 0; i < 2 && !out.ok; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        out = await confirmTicketPayment(sessionId);
      }
      if (!live) return;
      if (out.ok) {
        clearCart();
        reloadOrders();
        setState({ kind: "done" });
        window.history.replaceState(null, "", "/account#tickets");
      } else {
        setState({ kind: "error", text: out.error ?? "Could not confirm the payment." });
      }
    })();

    return () => {
      live = false;
    };
  }, [signedIn, reloadOrders, clearCart]);

  return state;
}

export default function Account() {
  const {
    ready,
    user,
    orders,
    ordersError,
    passCount,
    signOut,
    cancelOrder,
    reloadOrders,
    clearCart,
  } = useAccount();
  const now = useNow();
  const payment = usePaymentReturn(Boolean(ready && user), reloadOrders, clearCart);

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
          <Editable k="account.signedOut.title">Not signed in</Editable>
        </h1>
        <p className="mt-3 text-silverdim">
          <Editable k="account.signedOut.blurb">
            Sign in to see your tickets, or make an account if you don&rsquo;t
            have one yet.
          </Editable>
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link href="/login" className={btnGo}>
            Go to sign in
          </Link>
          <Link href="/signup" className={btn}>
            Make an account
          </Link>
        </div>
      </main>
    );
  }

  // The account is its Instagram handle, shown with the @ put back. An account
  // from before handles were required has no handle to put one on, so its name
  // is shown as it is.
  const shownName = user.instagram ? atHandle(user.name) : user.name;
  // Verified wins outright: a check still on file from before an approval is
  // not "pending" once the row says cleared.
  const pending = !user.verified && user.check?.status === "pending";

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div className="min-w-0">
          <h1 className="font-display chrome text-[clamp(2.25rem,9vw,4.5rem)] leading-[0.85] break-words">
            {shownName}
          </h1>
          <p className="label mt-3 flex flex-wrap gap-x-5 gap-y-1 text-silverfaint">
            <span className="break-all">{user.email.toUpperCase()}</span>
            <span className={user.verified ? "text-bloodhi" : "text-silverdim"}>
              {user.verified ? (
                <Editable k="account.age.verified">AGE VERIFIED</Editable>
              ) : pending ? (
                <Editable k="account.age.pending">AGE CHECK PENDING</Editable>
              ) : (
                <Editable k="account.age.notVerified">AGE NOT VERIFIED</Editable>
              )}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!user.verified && !pending && (
            <Link
              href="/verify"
              className="label flex min-h-11 items-center border border-[rgba(200,16,46,0.5)] px-4 text-chalk hover:border-bloodhi"
            >
              VERIFY AGE
            </Link>
          )}
          {pending && (
            // Quiet on purpose: there is nothing to do but wait, and /verify
            // says as much. The link is there so "pending" can be read up on.
            <Link
              href="/verify"
              className="label flex min-h-11 items-center border border-line px-4 text-silverfaint transition-colors hover:border-linehi hover:text-chalk"
            >
              AGE CHECK PENDING
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

      <div
        id="tickets"
        className="mt-8 mb-6 flex flex-wrap items-end justify-between gap-4 scroll-mt-28"
      >
        <h2 className="font-display text-[2rem]">
          <Editable k="account.tickets.title">Tickets</Editable>
          <span className="label ml-3 align-middle text-silverfaint">
            {passCount} <Editable k="account.tickets.across">ACROSS</Editable>{" "}
            {orders.length}{" "}
            {orders.length === 1 ? (
              <Editable k="account.tickets.order">ORDER</Editable>
            ) : (
              <Editable k="account.tickets.orders">ORDERS</Editable>
            )}
          </span>
        </h2>
        <Link href="/tickets" className="label text-silverdim hover:text-chalk">
          BROWSE DATES &rarr;
        </Link>
      </div>

      {payment && (
        <p
          className={`label mb-6 border px-4 py-3 leading-loose ${
            payment.kind === "error"
              ? "border-[rgba(200,16,46,0.5)] text-bloodhi"
              : "border-line text-silverdim"
          }`}
          role={payment.kind === "error" ? "alert" : "status"}
        >
          {payment.kind === "working" ? (
            <Editable k="account.paid.working">PAYMENT RECEIVED - ISSUING YOUR TICKETS…</Editable>
          ) : payment.kind === "done" ? (
            <Editable k="account.paid.done">PAID. YOUR TICKETS ARE BELOW.</Editable>
          ) : (
            <>
              <Editable k="account.paid.error">
                YOUR PAYMENT WENT THROUGH BUT THE TICKETS HAVE NOT SHOWN UP YET. REFRESH IN A MINUTE, OR DM US IF THEY DON&rsquo;T -
              </Editable>{" "}
              {payment.text.toUpperCase()}
            </>
          )}
        </p>
      )}

      {ordersError && (
        // What is below is still real - this says there may be more of it
        // than what loaded, not that the list itself is wrong.
        <p
          className="label mb-6 border border-[rgba(200,16,46,0.5)] px-4 py-3 leading-loose text-bloodhi"
          role="alert"
        >
          ORDERS FROM OTHER DEVICES MAY BE MISSING - {ordersError.toUpperCase()}
        </p>
      )}

      {orders.length === 0 ? (
        <div className="border border-dashed border-linehi p-8 text-center">
          <p className="text-silverdim">
            <Editable k="account.empty">Nothing booked yet.</Editable>
          </p>
          <Link href="/tickets" className={`${btnGo} mt-5`}>
            Browse tickets
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {orders.map((o) => {
            const ev = findEvent(o.eventSlug);
            const spent = ev ? isPastEvent(ev, now) : false;
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
                      <span>
                        <Editable k="account.order.label">ORDER</Editable> {o.id}
                      </span>
                      {ev && (
                        <span>
                          {ev.dow} {dayOf(ev.date)} {monthOf(ev.date)}
                        </span>
                      )}
                      <span className="text-chalk">
                        {o.totalCents === 0 ? (
                          <Editable k="account.order.free">FREE</Editable>
                        ) : (
                          usd(o.totalCents)
                        )}
                      </span>
                      {spent && (
                        <span>
                          <Editable k="account.order.past">PAST</Editable>
                        </span>
                      )}
                    </p>
                  </div>
                  {/* Only a free RSVP can be dropped from here. Cancelling a
                      paid order would void tickets without refunding them. */}
                  {o.totalCents === 0 && (
                    <button
                      onClick={() => cancelOrder(o.id)}
                      className="label flex min-h-11 items-center border border-line px-4 text-silverfaint transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi"
                    >
                      CANCEL ORDER
                    </button>
                  )}
                </header>

                <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
                  {o.passes.map((p) => (
                    <TicketPass
                      key={p.code}
                      pass={p}
                      eventSlug={o.eventSlug}
                      eventTitle={o.eventTitle}
                      orderId={o.id}
                      guestName={o.buyer.name}
                      issuedAt={o.createdAt}
                    />
                  ))}
                </div>

                {o.lines.some((l) => l.addon) && (
                  <p className="label border-t border-line px-4 py-3 leading-loose text-silverdim sm:px-5">
                    <Editable k="account.order.addons">ADD-ONS, PICK UP AT THE DOOR:</Editable>{" "}
                    <span className="text-chalk">
                      {o.lines
                        .filter((l) => l.addon)
                        .map((l) => `${l.qty}× ${l.tierName.toUpperCase()}`)
                        .join(" · ")}
                    </span>
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      <MyPrizes />

      <XpPanel />

      <AttendedEvents orders={orders} now={now} />

      <FriendsPanel />

      <SongRequests />

      <Link href="/tickets" className={`${btn} mt-12`}>
        Back to tickets
      </Link>
    </main>
  );
}
