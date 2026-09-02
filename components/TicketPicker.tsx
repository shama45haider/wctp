"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Event } from "@/lib/events";
import { useState } from "react";
import {
  admitsOf,
  DONATION_PRESETS,
  isPastEvent,
  isSoldOut,
  maxSelectable,
  money,
  remaining,
  saleState,
  tiersFor,
  totalsFor,
  usd,
  type Tier,
} from "@/lib/tickets";
import { useAccount } from "@/lib/demo-account";
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
 * Give-what-you-want row.
 *
 * Presets cover the common case in one tap; the field underneath takes any
 * amount, because the whole point of asking is not to cap the answer.
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
  const isPreset = DONATION_PRESETS.includes(amountCents);
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
          {amountCents > 0 ? usd(amountCents) : "Any amount"}
        </span>
      </div>
      {tier.blurb && (
        <p className="mt-1 max-w-[42ch] text-sm text-silverdim">{tier.blurb}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {DONATION_PRESETS.map((cents) => {
          const on = amountCents === cents;
          return (
            <button
              key={cents}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setCustom("");
                onChange(on ? null : cents);
              }}
              className={`font-display flex min-h-11 min-w-[4.5rem] items-center justify-center border px-4 transition-colors ${
                on
                  ? "border-bloodhi bg-[rgba(200,16,46,0.12)] text-chalk"
                  : "border-line text-silverdim hover:border-linehi hover:text-chalk"
              }`}
            >
              {usd(cents)}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label htmlFor={`amt-${tier.id}`} className="label text-silverfaint">
          OR ENTER AN AMOUNT
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
      {!isPreset && amountCents > 0 && (
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
          {admits > 1 && <span>ADMITS {admits}</span>}
          {soldOut ? (
            <span>SOLD OUT</span>
          ) : left <= LOW_STOCK ? (
            <span className="text-bloodhi">ONLY {left} LEFT</span>
          ) : (
            <span>{left} AVAILABLE</span>
          )}
          <span>MAX {tier.maxPerOrder} PER ORDER</span>
        </div>
      </div>

      <div className="font-display text-right text-[1.6rem] whitespace-nowrap">
        {money(tier.priceCents)}
      </div>

      {soldOut ? (
        <div className="label border border-line px-4 py-3 text-silverfaint">
          SOLD OUT
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
 * state, so a selection survives the detour through sign-in or the ID check
 * and is still waiting when the buyer lands back on checkout.
 */
export default function TicketPicker({ event }: { event: Event }) {
  const router = useRouter();
  const { ready, cart, adjustQty, setDonation } = useAccount();

  const tiers = tiersFor(event.slug);
  const state = saleState(event);

  if (state === "closed") {
    return (
      <div className="label border border-line px-4 py-4 text-silverfaint">
        {isPastEvent(event)
          ? "THIS EVENT HAS PASSED"
          : "TICKETS ARE NOT ON SALE YET"}
      </div>
    );
  }

  if (state === "sold-out") {
    return (
      <div className="border border-line p-6">
        <p className="font-display text-2xl">Sold out</p>
        <p className="mt-2 text-sm text-silverdim">
          Every tier is gone. Releases sometimes drop the week of the event -
          watch the feed.
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

  return (
    <div id="tickets" className="border border-line bg-ink">
      <div className="label flex items-center justify-between border-b border-line px-4 py-3 text-silverfaint">
        <span>SELECT TICKETS</span>
        <span>{tiers.length === 1 ? "1 TIER" : `${tiers.length} TIERS`}</span>
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
          <span>SUBTOTAL</span>
          <span className="text-chalk">{usd(totals.subtotalCents)}</span>
        </div>
        {totals.feeCents > 0 && (
          <div className="label mt-2 flex items-center justify-between text-silverfaint">
            <span>SERVICE FEE</span>
            <span>{usd(totals.feeCents)}</span>
          </div>
        )}
        <div className="font-display mt-3 flex items-center justify-between border-t border-line pt-3 text-[1.5rem]">
          <span>Total</span>
          <span>{usd(totals.totalCents)}</span>
        </div>

        <button
          type="button"
          disabled={!ready || empty}
          onClick={() => router.push("/checkout")}
          className={`${btnGo} mt-4 w-full`}
        >
          {empty
            ? "Select a ticket"
            : totals.ticketCount === 0
              ? `Donate ${usd(totals.donationCents)}`
              : `Checkout · ${totals.ticketCount} ${
                  totals.ticketCount === 1 ? "ticket" : "tickets"
                }`}
        </button>

        <p className="label mt-3 text-center text-silverfaint">
          18+ WITH ID ·{" "}
          <Link href="/tickets" className="underline hover:text-chalk">
            ALL DATES
          </Link>
        </p>
      </div>
    </div>
  );
}
