"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Event } from "@/lib/events";
import {
  admitsOf,
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
import { btnGo } from "@/lib/ui";

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
  const { ready, cart, adjustQty } = useAccount();

  const tiers = tiersFor(event.slug);
  const state = saleState(event);

  if (state === "closed") {
    return (
      <div className="label border border-line px-4 py-4 text-silverfaint">
        {isPastEvent(event) ? "THIS EVENT HAS PASSED" : "TICKETS ARE NOT ON SALE YET"}
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
      unitCents: t.priceCents,
      admits: admitsOf(t),
    }))
    .filter((l) => l.qty > 0);

  const totals = totalsFor(lines);
  const empty = lines.length === 0;

  return (
    <div id="tickets" className="border border-line bg-ink">
      <div className="label flex items-center justify-between border-b border-line px-4 py-3 text-silverfaint">
        <span>SELECT TICKETS</span>
        <span>{tiers.length === 1 ? "1 TIER" : `${tiers.length} TIERS`}</span>
      </div>

      {tiers.map((t) => (
        <TierRow
          key={t.id}
          tier={t}
          qty={qtyOf(t.id)}
          onStep={(d) => adjustQty(event.slug, t.id, d)}
        />
      ))}

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
