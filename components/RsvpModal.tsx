"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Event } from "@/lib/events";
import { monthOf, dayOf } from "@/lib/events";
import { useAccount, money, type Ticket } from "@/lib/demo-account";

type FlowStep = "details" | "pay" | "done";

const field =
  "border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none";
const btn =
  "font-display border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-[0.6rem] px-[1.15rem] tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim";
const btnGo =
  "font-display border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-[0.6rem] px-[1.15rem] tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)] disabled:cursor-not-allowed disabled:opacity-50";

export default function RsvpModal({
  event,
  onClose,
}: {
  event: Event;
  onClose: () => void;
}) {
  const { ready, user, addTicket } = useAccount();
  const priceCents = event.priceCents ?? 0;
  const isPaid = priceCents > 0;

  const [guests, setGuests] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>("details");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Derived, not synced: anyone not signed in and verified is held at the gate.
  const gated = !user || !user.verified;
  const step = gated ? "gate" : flowStep;

  const meta = `${event.dow} ${dayOf(event.date)} ${monthOf(event.date)} · ${event.time} · ${event.venue.toUpperCase()}`;
  const totalCents = priceCents * guests;

  const finish = () => {
    const t = addTicket({
      eventSlug: event.slug,
      eventTitle: event.title,
      guests,
      paidCents: totalCents,
    });
    setTicket(t);
    setFlowStep("done");
  };

  const pay = () => {
    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      finish();
    }, 1100);
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(3,3,4,0.86)] p-6 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`RSVP for ${event.title}`}
        className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border border-linehi bg-gradient-to-b from-ink2 to-[#08090b] p-8"
      >
        <div className="label mb-3 flex items-center justify-between text-silverfaint">
          <span>{isPaid ? money(priceCents) : "FREE ENTRY"}</span>
          <span>{event.dow}</span>
        </div>
        <h3 className="font-display text-4xl">{event.title}</h3>
        <p className="label mt-1 mb-7 text-silverdim">{meta}</p>

        {!ready && (
          <p className="label text-silverfaint">LOADING&hellip;</p>
        )}

        {ready && step === "gate" && (
          <div>
            <div className="border border-line p-5">
              <p className="label mb-3 text-bloodhi">
                {user ? "ID CHECK REQUIRED" : "ACCOUNT REQUIRED"}
              </p>
              <p className="text-sm leading-relaxed text-silverdim">
                {user
                  ? "Our nights are 18+. Verify your age once and you're cleared for every date after this one."
                  : "You need an account to hold a spot. Takes a minute, and you can look around with the demo guest first."}
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={onClose} className={`${btn} flex-1`}>
                Cancel
              </button>
              <Link
                href={user ? "/verify" : "/login"}
                className={`${btnGo} flex-1 text-center`}
              >
                {user ? "Verify ID" : "Sign in"}
              </Link>
            </div>
          </div>
        )}

        {ready && step === "details" && user && (
          <div>
            <div className="label mb-5 flex items-center justify-between border border-line px-3 py-2 text-silverfaint">
              <span>{user.email.toUpperCase()}</span>
              <span className="text-bloodhi">VERIFIED</span>
            </div>

            <div className="mb-4 flex flex-col gap-2">
              <label htmlFor="guests" className="label text-silverfaint">
                PARTY SIZE
              </label>
              <select
                id="guests"
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
                className={field}
              >
                <option value={1}>Just me</option>
                <option value={2}>Me + 1</option>
                <option value={3}>Me + 2</option>
              </select>
            </div>

            <div className="label flex items-center justify-between border-t border-line pt-4 text-silverdim">
              <span>TOTAL</span>
              <span className="text-chalk">{money(totalCents)}</span>
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={onClose} className={`${btn} flex-1`}>
                Cancel
              </button>
              <button
                onClick={() => (isPaid ? setFlowStep("pay") : finish())}
                className={`${btnGo} flex-1`}
              >
                {isPaid ? "Checkout" : "Confirm"}
              </button>
            </div>
          </div>
        )}

        {ready && step === "pay" && (
          <div>
            <div className="label mb-5 flex items-center justify-between border border-line px-3 py-2">
              <span className="text-silverfaint">
                {guests} × {money(priceCents)}
              </span>
              <span className="text-chalk">{money(totalCents)}</span>
            </div>

            <div className="mb-4 flex flex-col gap-2">
              <label htmlFor="card" className="label text-silverfaint">
                CARD NUMBER
              </label>
              <input
                id="card"
                readOnly
                value="4242 4242 4242 4242"
                aria-describedby="card-note"
                className={`${field} cursor-not-allowed text-silverdim`}
              />
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="exp" className="label text-silverfaint">
                  EXPIRY
                </label>
                <input
                  id="exp"
                  readOnly
                  value="12 / 30"
                  className={`${field} cursor-not-allowed text-silverdim`}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="cvc" className="label text-silverfaint">
                  CVC
                </label>
                <input
                  id="cvc"
                  readOnly
                  value="123"
                  className={`${field} cursor-not-allowed text-silverdim`}
                />
              </div>
            </div>

            <p id="card-note" className="label mb-5 text-silverfaint">
              TEST MODE &mdash; FIXED TEST CARD, NO REAL PAYMENT IS TAKEN
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setFlowStep("details")}
                className={`${btn} flex-1`}
                disabled={processing}
              >
                Back
              </button>
              <button
                onClick={pay}
                disabled={processing}
                className={`${btnGo} flex-1`}
              >
                {processing ? "Processing…" : `Pay ${money(totalCents)}`}
              </button>
            </div>
          </div>
        )}

        {ready && step === "done" && ticket && (
          <div className="py-2 text-center">
            <h4 className="font-display text-3xl">You&apos;re on the list</h4>
            <p className="label mt-2 text-silverdim">
              {ticket.paidCents > 0
                ? `PAID ${money(ticket.paidCents)}`
                : "FREE ENTRY"}{" "}
              · {ticket.guests === 1 ? "1 SPOT" : `${ticket.guests} SPOTS`}
            </p>
            <div className="my-5 border border-dashed border-linehi p-4 font-mono text-xl tracking-[0.14em] text-chalk">
              {ticket.code}
            </div>
            <p className="label text-silverdim">SHOW THIS AT THE DOOR</p>
            <div className="mt-6 flex gap-3">
              <Link href="/account" className={`${btn} flex-1 text-center`}>
                My tickets
              </Link>
              <button onClick={onClose} className={`${btnGo} flex-1`}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
