"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { atHandle } from "@/lib/handle";
import { useOwnProfile } from "@/lib/profile-data";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { usd } from "@/lib/tickets";
import { btn, btnGo, field } from "@/lib/ui";
import {
  confirmDonation,
  DONOR_BOARD_CHANGED,
  startDonationCheckout,
} from "@/lib/donate";
import { Editable } from "./Editable";

/**
 * A real gift, taken by Stripe's own hosted page - this site never sees a
 * card number. create-donation-checkout (a Deno function, see
 * supabase/functions/) starts the session and hands back its URL; the browser
 * is sent there directly. Stripe sends it back to `success_url` or
 * `cancel_url`, both this same page, so the phase after a redirect is read
 * from the URL on mount rather than kept in memory - a full navigation away
 * and back would have lost anything kept in state.
 *
 * A signed-in donor can go on the donor board. The choice rides to Stripe with
 * the checkout and comes back through donation-status, which records the gift.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** $1. Small enough that "give whatever you want" is not a lie. */
const MIN_CENTS = 100;
const PRESETS_CENTS = [1000, 2500, 5000, 10000];

/** Parses "20", "$20", "20.50" to cents. Null for anything it cannot read. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".")
    return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

type Phase = "form" | "redirecting" | "verifying" | "done";

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-silverfaint border-t-bloodhi align-[-2px]"
    />
  );
}

export default function DonateForm() {
  const { ready, user } = useSupabaseAuth();
  const { profile } = useOwnProfile(user?.id);
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [given, setGiven] = useState(0);
  const [onBoard, setOnBoard] = useState(false);
  const [showOnBoard, setShowOnBoard] = useState(true);

  // Reads the redirect Stripe sent back, once, on the way in. The server-
  // rendered pass always shows the plain form - this only runs after mount,
  // so there is nothing here for hydration to disagree with. Every state
  // update below runs from inside a timer or a promise callback rather than
  // directly in the effect body.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sessionId = p.get("session_id");
    const succeeded = p.get("success") === "1" && sessionId;
    const canceled = p.get("canceled") === "1";
    if (!succeeded && !canceled) return;

    window.history.replaceState(null, "", window.location.pathname);

    window.setTimeout(() => {
      if (canceled) {
        setNotice("Payment canceled - nothing was charged.");
        return;
      }
      setPhase("verifying");
      void confirmDonation(sessionId!).then((res) => {
        if (res.ok) {
          setGiven(res.amountCents);
          setOnBoard(res.onBoard);
          setPhase("done");
          window.dispatchEvent(new Event(DONOR_BOARD_CHANGED));
        } else {
          setProblem(res.error);
          setPhase("form");
        }
      });
    }, 0);
  }, []);

  const submit = async (e: React.FormEvent) => {
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
    setPhase("redirecting");

    const res = await startDonationCheckout({
      amountCents: cents,
      name: name.trim(),
      email: email.trim(),
      showOnBoard: Boolean(user) && showOnBoard,
    });
    if (!res.ok) {
      setProblem(res.error);
      setPhase("form");
      return;
    }
    // Left as "redirecting" deliberately - the tab is about to navigate away
    // entirely, so there is no later render that needs this reset.
    window.location.href = res.url;
  };

  if (phase === "verifying") {
    return (
      <div className="mt-8 flex flex-col items-center gap-3 border border-line bg-ink px-6 py-14 text-center">
        <Spinner />
        <p className="label text-silverfaint">CONFIRMING YOUR GIFT&hellip;</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="relative mt-8 overflow-hidden border border-line bg-ink p-6">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-bloodhi to-transparent"
        />
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
        {onBoard && (
          <p className="label mt-3 text-bloodhi">
            <Editable k="donate.done.onBoard">YOU&rsquo;RE ON THE DONOR BOARD BELOW</Editable>
          </p>
        )}
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

  const redirecting = phase === "redirecting";
  const cents = parseAmount(amount);

  return (
    <form
      onSubmit={submit}
      className="relative mt-8 flex flex-col gap-5 overflow-hidden border border-line bg-ink p-5 sm:p-6"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-bloodhi to-transparent"
      />

      {notice && (
        <p className="label border border-line px-3 py-2.5 text-silverdim">
          {notice.toUpperCase()}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="donate-amount" className="label text-silverfaint">
          <Editable k="donate.form.amountLabel">AMOUNT</Editable>
        </label>
        <div className="flex items-stretch">
          <span className="font-display flex items-center border border-r-0 border-line bg-[#0a0b0d] px-4 text-[1.4rem] text-silverfaint">
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
            disabled={redirecting}
            className={`${field} font-display w-full text-[1.4rem]`}
          />
        </div>

        <div className="mt-1 grid grid-cols-4 gap-2">
          {PRESETS_CENTS.map((c) => {
            const active = cents === c;
            return (
              <button
                key={c}
                type="button"
                disabled={redirecting}
                onClick={() => {
                  setAmount(String(c / 100));
                  setProblem(null);
                }}
                className={`label min-h-11 border px-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-bloodhi bg-[rgba(200,16,46,0.12)] text-bloodhi"
                    : "border-line text-silverdim hover:border-linehi hover:text-chalk"
                }`}
              >
                {usd(c).replace(".00", "")}
              </button>
            );
          })}
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
          disabled={redirecting}
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
          disabled={redirecting}
          className={field}
        />
        <p className="label leading-loose text-silverfaint">
          <Editable k="donate.form.emailNote">
            FOR A RECEIPT ONLY. NOT AN ACCOUNT AND NOT A TICKET.
          </Editable>
        </p>
      </div>

      {ready &&
        (user ? (
          <div className="flex flex-col gap-1.5 border border-line px-3 py-3">
            <label htmlFor="donate-board" className="flex min-h-6 cursor-pointer items-start gap-3">
              <input
                id="donate-board"
                type="checkbox"
                checked={showOnBoard}
                onChange={(e) => setShowOnBoard(e.target.checked)}
                disabled={redirecting}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#e8213f]"
              />
              <span className="text-sm leading-snug text-chalk">
                {profile?.instagram
                  ? `Put me on the donor board as ${atHandle(profile.instagram)}`
                  : "Put me on the donor board"}
              </span>
            </label>
            <p className="pl-7 text-[0.8125rem] leading-snug text-silverdim">
              {profile?.instagram ? (
                <Editable k="donate.form.boardNote">
                  Your picture and Instagram go up so people can follow you.
                </Editable>
              ) : (
                <>
                  <Editable k="donate.form.boardNoHandle">Add your Instagram on</Editable>{" "}
                  <Link href="/profile" className="underline hover:text-chalk">
                    your profile
                  </Link>{" "}
                  <Editable k="donate.form.boardNoHandleEnd">so people can follow you.</Editable>
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="text-sm leading-snug text-silverdim">
            <Link href="/login" className="underline hover:text-chalk">
              Sign in
            </Link>{" "}
            <Editable k="donate.form.boardSignIn">
              first to get on the donor board with your picture and Instagram.
            </Editable>
          </p>
        ))}

      <div className="label flex items-center gap-2 border border-line px-3 py-2.5 text-silverdim">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 flex-none fill-none stroke-current"
          strokeWidth="2"
        >
          <rect x="4" y="10" width="16" height="10" rx="1.5" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        <Editable k="donate.form.stripeNote">
          {"PAID THROUGH STRIPE’S OWN SECURE CHECKOUT · YOUR CARD NEVER TOUCHES THIS SITE"}
        </Editable>
      </div>

      {problem && (
        <p className="label text-bloodhi" role="alert">
          {problem}
        </p>
      )}

      <button type="submit" disabled={redirecting} className={btnGo}>
        {redirecting ? (
          <span className="inline-flex items-center gap-2">
            <Spinner /> Taking you to Stripe&hellip;
          </span>
        ) : cents !== null && cents > 0 ? (
          `Give ${usd(cents)}`
        ) : (
          "Give"
        )}
      </button>
    </form>
  );
}
