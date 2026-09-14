"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usd } from "@/lib/tickets";
import { btn, btnGo, field } from "@/lib/ui";
import { Editable } from "./Editable";

/**
 * A gift, taken the same way the "TEST MODE" step in checkout already takes
 * a ticket payment - no card is charged and none is asked for, because
 * nothing on this site processes a real one yet (see CheckoutFlow.tsx). A
 * donation here is not attached to an order, an account or an event, so it
 * does not appear in a guest's own order history or in the admin dashboard
 * the way a ticket-page donation tier does; wiring that up is real work for
 * whenever a payment processor actually sits behind this button, and would
 * be premature before one does.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** $1. Small enough that "give whatever you want" is not a lie. */
const MIN_CENTS = 100;

/** Parses "20", "$20", "20.50" to cents. Null for anything it cannot read. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".")
    return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

type Phase = "form" | "paying" | "done";

export default function DonateForm() {
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [given, setGiven] = useState(0);

  // Ticks the progress bar to 100 - the same simulated pace CheckoutFlow
  // uses for a ticket payment.
  useEffect(() => {
    if (progress === null || progress >= 100) return;
    const id = window.setTimeout(() => setProgress((p) => (p ?? 0) + 10), 90);
    return () => window.clearTimeout(id);
  }, [progress]);

  // Kept out of the ticking effect so this fires once, on arrival at 100,
  // rather than on every re-render that happens to see a full bar - and
  // deferred a beat so the bar visibly finishes before the screen changes.
  useEffect(() => {
    if (progress !== 100) return;
    const id = window.setTimeout(() => {
      setGiven(parseAmount(amount) ?? 0);
      setPhase("done");
      setProgress(null);
    }, 260);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseAmount(amount);
    if (cents === null || cents < MIN_CENTS) {
      setProblem(`Give at least ${usd(MIN_CENTS)}.`);
      return;
    }
    if (name.trim().length < 1) {
      setProblem("Put in a name.");
      return;
    }
    if (!EMAIL.test(email.trim())) {
      setProblem("That email doesn't look right.");
      return;
    }
    setProblem(null);
    setPhase("paying");
    setProgress(0);
  };

  if (phase === "done") {
    return (
      <div className="mt-8 border border-line bg-ink p-6">
        <p className="label text-bloodhi">
          <Editable k="donate.done.eyebrow">THANK YOU</Editable>
        </p>
        <h2 className="font-display chrome mt-2 text-[clamp(1.75rem,6vw,2.5rem)] leading-[0.9]">
          {usd(given)} <Editable k="donate.done.givenLabel">given</Editable>
        </h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          <Editable k="donate.done.blurb">
            It goes straight into the next date. See you there.
          </Editable>
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link href="/tickets" className={btnGo}>
            Browse tickets
          </Link>
          <Link href="/" className={btn}>
            Back home
          </Link>
        </div>
      </div>
    );
  }

  const paying = phase === "paying";

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="donate-amount" className="label text-silverfaint">
          <Editable k="donate.form.amountLabel">AMOUNT</Editable>
        </label>
        <div className="flex items-center">
          <span className="label border border-r-0 border-line px-3.5 py-2.5 text-silverfaint">
            $
          </span>
          <input
            id="donate-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setProblem(null);
            }}
            placeholder="0.00"
            disabled={paying}
            className={`${field} w-full`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="donate-name" className="label text-silverfaint">
          <Editable k="donate.form.nameLabel">NAME</Editable>
        </label>
        <input
          id="donate-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
          autoComplete="name"
          disabled={paying}
          className={field}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="donate-email" className="label text-silverfaint">
          <Editable k="donate.form.emailLabel">EMAIL</Editable>
        </label>
        <input
          id="donate-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setProblem(null);
          }}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          disabled={paying}
          className={field}
        />
        <p className="label leading-loose text-silverfaint">
          <Editable k="donate.form.emailNote">
            FOR A RECEIPT ONLY. NOT AN ACCOUNT AND NOT A TICKET.
          </Editable>
        </p>
      </div>

      {!paying && (
        <div className="label border border-[rgba(200,16,46,0.5)] px-3 py-2.5 text-bloodhi">
          <Editable k="donate.form.testMode">
            TEST MODE · NO CARD IS CHARGED AND NO CARD DETAILS ARE TAKEN
          </Editable>
        </div>
      )}

      {problem && (
        <p className="label text-bloodhi" role="alert">
          {problem}
        </p>
      )}

      {progress !== null && (
        <div>
          <div className="h-1 w-full bg-line">
            <div
              className="h-full bg-blood transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="label mt-2 flex justify-between text-silverfaint">
            <span>SENDING YOUR GIFT</span>
            <span>{progress}%</span>
          </p>
        </div>
      )}

      <button type="submit" disabled={paying} className={btnGo}>
        {paying
          ? "Working…"
          : (() => {
              const cents = parseAmount(amount);
              return cents !== null && cents > 0 ? `Give ${usd(cents)}` : "Give";
            })()}
      </button>
    </form>
  );
}
