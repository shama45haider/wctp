"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Editable } from "./Editable";
import PoshLink from "./PoshLink";
import type { Event } from "@/lib/events";
import { useState } from "react";
import {
  admitsOf,
  isPastEvent,
  isSoldOut,
  maxSelectable,
  money,
  poshRsvpFor,
  remaining,
  saleState,
  tiersFor,
  totalsFor,
  usd,
  type Tier,
} from "@/lib/tickets";
import { useAccount } from "@/lib/demo-account";
import { useNow } from "@/lib/now";
import { btnGo, field } from "@/lib/ui";

/** Stock is only worth naming once it is scarce enough to hurry someone. */
const LOW_STOCK = 25;

function Stepper({
  tier,
  qty,
  onStep,
}: {
  tier: Tier;
  qty: number;
  /** Relative, so a fast double-tap cannot land twice on the same stale count. */
  onStep: (delta: number) => void;
}) {
  const max = maxSelectable(tier);

  return (
    <div className="flex items-center border border-line">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={qty === 0}
        aria-label={`Remove one ${tier.name}`}
        className="font-display flex h-11 w-11 items-center justify-center text-xl text-silverdim transition-colors hover:text-chalk disabled:opacity-30 disabled:hover:text-silverdim"
      >
        &minus;
      </button>
      <span
        aria-live="polite"
        className="label w-9 text-center text-base text-chalk"
      >
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={qty >= max}
        aria-label={`Add one ${tier.name}`}
        className="font-display flex h-11 w-11 items-center justify-center text-xl text-silverdim transition-colors hover:text-chalk disabled:opacity-30 disabled:hover:text-silverdim"
      >
        +
      </button>
    </div>
  );
}

/** Parses "20", "$20", "20.50" to cents. Null for anything it cannot read. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".")
    return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * Give-what-you-want row. One open field and no suggested amounts, so the
 * question never anchors the answer.
 */
function DonationRow({
  tier,
  amountCents,
  onChange,
}: {
  tier: Tier;
  /** 0 when nothing is being given. */
  amountCents: number;
  onChange: (cents: number | null) => void;
}) {
  const [custom, setCustom] = useState("");
  const min = tier.minCents ?? 100;
  const parsed = parseAmount(custom);
  const tooSmall = parsed !== null && parsed > 0 && parsed < min;

  const commit = (raw: string) => {
    setCustom(raw);
    const cents = parseAmount(raw);
    if (cents === null) return;
    onChange(cents >= min ? cents : null);
  };

  return (
    <div
      className={`border-b border-line px-4 py-5 transition-colors ${
        amountCents > 0 ? "bg-[rgba(200,16,46,0.05)]" : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="font-display text-[1.35rem]">{tier.name}</h3>
        <span className="font-display text-[1.6rem] whitespace-nowrap">
          {amountCents > 0 ? (
            usd(amountCents)
          ) : (
            <Editable k="event.picker.anyAmount">Any amount</Editable>
          )}
        </span>
      </div>
      {tier.blurb && (
        <p className="mt-1 max-w-[42ch] text-sm text-silverdim">{tier.blurb}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor={`amt-${tier.id}`} className="label text-silverfaint">
          <Editable k="event.picker.enterAmount">ENTER AN AMOUNT</Editable>
        </label>
        <div className="flex items-center">
          <span className="label border border-r-0 border-line px-3 py-2.5 text-silverfaint">
            $
          </span>
          <input
            id={`amt-${tier.id}`}
            inputMode="decimal"
            value={custom}
            onChange={(e) => commit(e.target.value)}
            placeholder="0.00"
            aria-describedby={tooSmall ? `amt-${tier.id}-err` : undefined}
            className={`${field} w-28`}
          />
        </div>
        {amountCents > 0 && (
          <button
            type="button"
            onClick={() => {
              setCustom("");
              onChange(null);
            }}
            className="label text-silverfaint underline transition-colors hover:text-chalk"
          >
            CLEAR
          </button>
        )}
      </div>

      {tooSmall && (
        <p id={`amt-${tier.id}-err`} className="label mt-2 text-bloodhi">
          MINIMUM {usd(min)}
        </p>
      )}
      {amountCents > 0 && (
        <p className="label mt-2 text-silverfaint">
          GIVING {usd(amountCents)} - THANK YOU
        </p>
      )}
    </div>
  );
}

function TierRow({
  tier,
  qty,
  onStep,
}: {
  tier: Tier;
  qty: number;
  onStep: (delta: number) => void;
}) {
  const left = remaining(tier);
  const soldOut = isSoldOut(tier);
  const admits = admitsOf(tier);

  return (
    <div
      className={`flex flex-wrap items-center gap-x-6 gap-y-4 border-b border-line px-4 py-5 transition-colors ${
        soldOut ? "opacity-45" : qty > 0 ? "bg-[rgba(200,16,46,0.05)]" : ""
      }`}
    >
      <div className="min-w-[10rem] flex-1">
        <h3 className="font-display text-[1.35rem]">{tier.name}</h3>
        {tier.blurb && (
          <p className="mt-1 max-w-[42ch] text-sm text-silverdim">
            {tier.blurb}
          </p>
        )}
        <div className="label mt-2 flex flex-wrap gap-x-4 gap-y-1 text-silverfaint">
          {admits > 1 && (
            <span>
              <Editable k="event.picker.tier.admits">ADMITS</Editable> {admits}
            </span>
          )}
          {soldOut ? (
            <span>
              <Editable k="event.picker.tier.soldOut">SOLD OUT</Editable>
            </span>
          ) : left <= LOW_STOCK ? (
            <span className="text-bloodhi">
              <Editable k="event.picker.tier.only">ONLY</Editable> {left}{" "}
              <Editable k="event.picker.tier.left">LEFT</Editable>
            </span>
          ) : (
            <span>
              {left} <Editable k="event.picker.tier.available">AVAILABLE</Editable>
            </span>
          )}
          <span>
            <Editable k="event.picker.tier.max">MAX</Editable> {tier.maxPerOrder}{" "}
            <Editable k="event.picker.tier.perOrder">PER ORDER</Editable>
          </span>
        </div>
      </div>

      <div className="font-display text-right text-[1.6rem] whitespace-nowrap">
        {money(tier.priceCents)}
      </div>

      {soldOut ? (
        <div className="label border border-line px-4 py-3 text-silverfaint">
          <Editable k="event.picker.tier.soldOutBox">SOLD OUT</Editable>
        </div>
      ) : (
        <Stepper tier={tier} qty={qty} onStep={onStep} />
      )}
    </div>
  );
}

/**
 * Tier selection for one event.
 *
 * Quantities are written straight to the shared cart rather than held in local
 * state, so a selection survives the detour through sign-in or the age check
 * and is still waiting when the buyer lands back on checkout.
 *
 * The primary button is where an RSVP is attempted, so it is also where the
 * rule is enforced: nobody RSVPs without an account whose age a person has
 * checked. It sends the signed-out to sign-in and the unchecked to the age
 * check, and says so on its face rather than letting someone tap "Checkout"
 * and land on a form wondering why. A gift is not an RSVP and skips all that.
 */
export default function TicketPicker({ event }: { event: Event }) {
  const router = useRouter();
  const { ready, user, cart, adjustQty, setDonation } = useAccount();
  // The page around this widget is a static export, built once - saleState
  // and isPastEvent default to that build's frozen date if nothing is passed
  // to them, which is exactly wrong for the one place that actually sells a
  // ticket. Passing the visitor's real clock here is what stops someone
  // buying into a night that has already happened just because the page
  // itself has not been rebuilt since.
  const now = useNow();

  const tiers = tiersFor(event.slug);
  const state = saleState(event, now);

  // Sold somewhere else, set per event from the dashboard. Checked after
  // saleState rather than before it, so a date that has already happened says
  // so instead of cheerfully sending someone off to buy a ticket for it.
  if (event.ticketRedirectUrl && state !== "closed") {
    return (
      <div id="tickets" className="border border-line bg-ink p-4">
        <p className="text-sm leading-relaxed text-silverdim">
          <Editable k="event.picker.offsite.blurb">
            Tickets for this one are sold off-site.
          </Editable>
        </p>
        <a
          href={event.ticketRedirectUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btnGo} mt-4 w-full`}
        >
          Get tickets
        </a>
        <p className="label mt-3 text-center text-silverfaint">
          <Link
            href="/tickets"
            className="-my-3 inline-block py-3 underline hover:text-chalk"
          >
            ALL DATES
          </Link>
        </p>
      </div>
    );
  }

  // Taken on Posh, not here - see poshRsvpFor() in lib/tickets.ts. No tiers,
  // no cart: the button goes straight to the Posh event page.
  const posh = poshRsvpFor(event.slug);
  if (posh && state === "on-sale") {
    return (
      <div id="tickets" className="border border-line bg-ink p-4">
        <p className="text-sm leading-relaxed text-silverdim">
          <Editable k="event.picker.posh.blurb">
            RSVPs for this date are taken on Posh.
          </Editable>
        </p>
        <PoshLink href={posh} className={`${btnGo} mt-4 w-full`}>
          Get tickets
        </PoshLink>
        <p className="label mt-3 text-center text-silverfaint">
          <Link
            href="/tickets"
            className="-my-3 inline-block py-3 underline hover:text-chalk"
          >
            ALL DATES
          </Link>
        </p>
      </div>
    );
  }

  if (state === "closed") {
    return (
      <div className="label border border-line px-4 py-4 text-silverfaint">
        {isPastEvent(event, now) ? (
          <Editable k="event.picker.passed">THIS EVENT HAS PASSED</Editable>
        ) : (
          <Editable k="event.picker.notYet">TICKETS ARE NOT ON SALE YET</Editable>
        )}
      </div>
    );
  }

  if (state === "sold-out") {
    return (
      <div className="border border-line p-6">
        <p className="font-display text-2xl">
          <Editable k="event.picker.soldOutTitle">Sold out</Editable>
        </p>
        <p className="mt-2 text-sm text-silverdim">
          <Editable k="event.picker.soldOutBlurb">
            Every tier is gone. Releases sometimes drop the week of the event -
            watch the feed.
          </Editable>
        </p>
      </div>
    );
  }

  // The cart holds one event at a time; a cart for another night reads as empty
  // here rather than leaking its quantities into this picker.
  const mine = cart?.eventSlug === event.slug ? cart : null;
  const qtyOf = (id: string) => mine?.qty[id] ?? 0;

  const lines = tiers
    .map((t) => ({
      tierId: t.id,
      tierName: t.name,
      qty: Math.min(qtyOf(t.id), maxSelectable(t)),
      unitCents: t.donation ? (mine?.amounts?.[t.id] ?? 0) : t.priceCents,
      admits: admitsOf(t),
      donation: t.donation,
    }))
    .filter((l) => l.qty > 0 && (!l.donation || l.unitCents > 0));

  const totals = totalsFor(lines);
  const empty = lines.length === 0;

  // Only admission goes through the gate. Until the account has answered the
  // button is disabled anyway, so it keeps the plain checkout label rather
  // than flashing "Sign in" at someone who is about to turn out to be signed in.
  const rsvp = totals.ticketCount > 0;
  const gate =
    !ready || !rsvp
      ? null
      : !user
        ? "signin"
        : !user.verified
          ? "verify"
          : null;
  const destination =
    gate === "signin" ? "/login" : gate === "verify" ? "/verify" : "/checkout";
  const label = empty
    ? "Select a ticket"
    : !rsvp
      ? `Donate ${usd(totals.donationCents)}`
      : gate === "signin"
        ? "Sign in to RSVP"
        : gate === "verify"
          ? user?.check?.status === "pending"
            ? "Age check pending"
            : "Verify your age to RSVP"
          : `Checkout · ${totals.ticketCount} ${
              totals.ticketCount === 1 ? "ticket" : "tickets"
            }`;

  return (
    <div id="tickets" className="border border-line bg-ink">
      <div className="label flex items-center justify-between border-b border-line px-4 py-3 text-silverfaint">
        <span>
          <Editable k="event.picker.selectTickets">SELECT TICKETS</Editable>
        </span>
        <span>
          {tiers.length}{" "}
          {tiers.length === 1 ? (
            <Editable k="event.picker.tierLabel">TIER</Editable>
          ) : (
            <Editable k="event.picker.tiersLabel">TIERS</Editable>
          )}
        </span>
      </div>

      {tiers.map((t) =>
        t.donation ? (
          <DonationRow
            key={t.id}
            tier={t}
            amountCents={qtyOf(t.id) > 0 ? (mine?.amounts?.[t.id] ?? 0) : 0}
            onChange={(cents) => setDonation(event.slug, t.id, cents)}
          />
        ) : (
          <TierRow
            key={t.id}
            tier={t}
            qty={qtyOf(t.id)}
            onStep={(d) => adjustQty(event.slug, t.id, d)}
          />
        ),
      )}

      <div className="p-4">
        <div className="label flex items-center justify-between text-silverdim">
          <span>
            <Editable k="event.picker.subtotal">SUBTOTAL</Editable>
          </span>
          <span className="text-chalk">{usd(totals.subtotalCents)}</span>
        </div>
        {totals.feeCents > 0 && (
          <div className="label mt-2 flex items-center justify-between text-silverfaint">
            <span>
              <Editable k="event.picker.serviceFee">SERVICE FEE</Editable>
            </span>
            <span>{usd(totals.feeCents)}</span>
          </div>
        )}
        <div className="font-display mt-3 flex items-center justify-between border-t border-line pt-3 text-[1.5rem]">
          <span>
            <Editable k="event.picker.total">Total</Editable>
          </span>
          <span>{usd(totals.totalCents)}</span>
        </div>

        <button
          type="button"
          disabled={!ready || empty}
          onClick={() => router.push(destination)}
          className={`${btnGo} mt-4 w-full`}
        >
          {label}
        </button>

        <p className="label mt-3 text-center text-silverfaint">
          <Editable k="event.picker.footer">18+ · AGE CHECKED BY A PERSON ·</Editable>{" "}
          <Link
            href="/tickets"
            className="-my-3 inline-block py-3 underline hover:text-chalk"
          >
            ALL DATES
          </Link>
        </p>
      </div>
    </div>
  );
}
