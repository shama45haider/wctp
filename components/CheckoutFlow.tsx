"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Flyer from "./Flyer";
import TicketPass from "./TicketPass";
import { findEvent, monthOf, dayOf } from "@/lib/events";
import {
  findPromo,
  icsFor,
  maxSelectable,
  money,
  PROMOS,
  tiersFor,
  totalsFor,
  usd,
  type OrderLine,
  type Totals,
} from "@/lib/tickets";
import { useAccount, type Order } from "@/lib/demo-account";
import { btn, btnGo, field } from "@/lib/ui";

type Step = "order" | "details" | "payment" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "order", label: "ORDER" },
  { id: "details", label: "DETAILS" },
  { id: "payment", label: "PAYMENT" },
  { id: "done", label: "TICKETS" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Progress({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="label mb-7 flex gap-2 text-silverfaint">
      {STEPS.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === at ? "step" : undefined}
          className={`flex-1 border-t-2 pt-2 ${
            i === at
              ? "border-blood text-bloodhi"
              : i < at
                ? "border-linehi text-silverdim"
                : "border-line"
          }`}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      {children}
    </main>
  );
}

/**
 * Empty, and everything that reads like empty: no cart, or a stale one.
 *
 * Reloading this page after paying also lands here, because the confirmation
 * lives in component state. Anyone holding tickets gets pointed at them rather
 * than being told, misleadingly, that there is nothing.
 */
function NothingToBuy({ ticketCount }: { ticketCount: number }) {
  return (
    <Shell>
      <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
        Your order is empty
      </h1>
      <p className="mt-3 max-w-[46ch] text-silverdim">
        Nothing is being held. Pick a night and choose your tickets - the order
        stays put while you sign in.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/tickets" className={btnGo}>
          Browse tickets
        </Link>
        {ticketCount > 0 && (
          <Link href="/account" className={btn}>
            My {ticketCount} {ticketCount === 1 ? "ticket" : "tickets"}
          </Link>
        )}
      </div>
    </Shell>
  );
}

/**
 * The order, priced, alongside the flyer it belongs to.
 *
 * Rendered on every step so the total never leaves the screen while someone is
 * typing card details into the step beside it.
 */
function Summary({
  slug,
  title,
  lines,
  totals,
  promoLabel,
  feeWaived,
}: {
  slug: string;
  title: string;
  lines: OrderLine[];
  totals: Totals;
  promoLabel?: string;
  /** True only when a code removed a fee that would otherwise have applied. */
  feeWaived?: boolean;
}) {
  const ev = findEvent(slug);

  return (
    <aside className="border border-line bg-ink lg:sticky lg:top-28">
      {ev?.imageId && (
        <div className="relative aspect-[16/9] overflow-hidden border-b border-line">
          <Flyer
            id={ev.imageId}
            alt=""
            sizes="(max-width:1023px) 92vw, 360px"
            maxWidth={640}
            className="opacity-80"
          />
        </div>
      )}

      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-[1.5rem] break-words">{title}</h2>
        {ev && (
          <p className="label mt-1.5 text-silverdim">
            {ev.dow} {dayOf(ev.date)} {monthOf(ev.date)} · {ev.time} ·{" "}
            {ev.venue.toUpperCase()}
          </p>
        )}
      </div>

      <dl className="px-5 py-4">
        {lines.map((l) => (
          <div key={l.tierId} className="mb-3 flex justify-between gap-4">
            <dt className="text-sm text-silver">
              {l.tierName}
              <span className="label ml-2 text-silverfaint">
                × {l.qty} @ {money(l.unitCents)}
              </span>
            </dt>
            <dd className="label text-chalk">{usd(l.unitCents * l.qty)}</dd>
          </div>
        ))}

        <div className="label mt-4 flex justify-between border-t border-line pt-4 text-silverdim">
          <dt>SUBTOTAL</dt>
          <dd className="text-chalk">{usd(totals.subtotalCents)}</dd>
        </div>

        {totals.discountCents > 0 && (
          <div className="label mt-2 flex justify-between text-bloodhi">
            <dt>{promoLabel ? promoLabel.toUpperCase() : "DISCOUNT"}</dt>
            <dd>&minus;{usd(totals.discountCents)}</dd>
          </div>
        )}

        {/* An all-free order never had a fee, so "waived" would be a boast
            about nothing. The row only appears when there is a fee, or when a
            code actually took one away. */}
        {(totals.feeCents > 0 || feeWaived) && (
          <div className="label mt-2 flex justify-between text-silverdim">
            <dt>SERVICE FEE</dt>
            <dd className={feeWaived ? "text-bloodhi" : ""}>
              {feeWaived ? "WAIVED" : usd(totals.feeCents)}
            </dd>
          </div>
        )}

        <div className="font-display mt-4 flex justify-between border-t border-line pt-4 text-[1.65rem]">
          <dt>Total</dt>
          <dd>{usd(totals.totalCents)}</dd>
        </div>
      </dl>
    </aside>
  );
}

function QtyStepper({
  qty,
  max,
  label,
  onStep,
}: {
  qty: number;
  max: number;
  label: string;
  /** Relative: see the note on `adjustQty` in lib/demo-account.tsx. */
  onStep: (delta: number) => void;
}) {
  return (
    <div className="flex items-center border border-line">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={qty === 0}
        aria-label={`Remove one ${label}`}
        className="font-display flex h-10 w-10 items-center justify-center text-lg text-silverdim hover:text-chalk disabled:opacity-30"
      >
        &minus;
      </button>
      <span className="label w-8 text-center text-sm text-chalk">{qty}</span>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={qty >= max}
        aria-label={`Add one ${label}`}
        className="font-display flex h-10 w-10 items-center justify-center text-lg text-silverdim hover:text-chalk disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}

export default function CheckoutFlow() {
  const {
    ready,
    user,
    cart,
    lines,
    passCount,
    adjustQty,
    setPromoCode,
    clearCart,
    placeOrder,
  } = useAccount();

  const [step, setStep] = useState<Step>("order");
  const [order, setOrder] = useState<Order | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [touched, setTouched] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const prefilled = useRef(false);

  // Prefill once from the account, then leave the fields alone - re-syncing on
  // every render would fight anyone editing the name they bought under.
  useEffect(() => {
    if (prefilled.current || !user) return;
    prefilled.current = true;
    setBuyer({
      name: user.name,
      email: user.email,
      phone: user.phone ?? "",
    });
  }, [user]);

  // Payment simulation. Ticks to 100, then issues the order.
  useEffect(() => {
    if (progress === null) return;
    if (progress >= 100) return;
    const id = window.setTimeout(() => setProgress((p) => (p ?? 0) + 10), 90);
    return () => window.clearTimeout(id);
  }, [progress]);

  const event = cart ? findEvent(cart.eventSlug) : null;
  const promo = cart?.promoCode ? findPromo(cart.promoCode) : null;
  const totals = totalsFor(lines, promo);

  const settle = () => {
    const placed = placeOrder(
      {
        name: buyer.name.trim(),
        email: buyer.email.trim(),
        phone: buyer.phone.trim() || undefined,
      },
      event?.title ?? cart?.eventSlug ?? "Event",
    );
    if (placed) {
      setOrder(placed);
      setStep("done");
    }
    setProgress(null);
  };

  // Kept out of the ticking effect so the order is issued once, on arrival at
  // 100, rather than on every re-render that happens to see a full bar.
  useEffect(() => {
    if (progress !== 100) return;
    const id = window.setTimeout(settle, 260);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  if (!ready) {
    return (
      <Shell>
        <p className="label text-silverfaint">LOADING&hellip;</p>
      </Shell>
    );
  }

  if (step === "done" && order) {
    return <Confirmation order={order} />;
  }

  if (!cart || lines.length === 0 || !event)
    return <NothingToBuy ticketCount={passCount} />;

  const gate = !user ? "signin" : !user.verified ? "verify" : null;
  const nameOk = buyer.name.trim().length > 1;
  const emailOk = EMAIL.test(buyer.email.trim());
  const detailsOk = nameOk && emailOk;
  const free = totals.totalCents === 0;

  const applyPromo = () => {
    const found = findPromo(promoInput);
    if (!found) {
      setPromoError("That code is not valid.");
      return;
    }
    setPromoError(null);
    setPromoCode(found.code);
    setPromoInput("");
  };

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link
          href={`/events/${event.slug}`}
          className="label -my-3 py-3 text-silverfaint hover:text-chalk"
        >
          &larr; BACK TO EVENT
        </Link>
        <button
          onClick={clearCart}
          className="label -my-3 py-3 text-silverfaint hover:text-bloodhi"
        >
          EMPTY ORDER
        </button>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Progress step={step} />

          {step === "order" && (
            <section>
              <h1 className="font-display chrome text-[clamp(1.9rem,5vw,3rem)] leading-[0.9]">
                Your order
              </h1>

              <div className="mt-6 border border-line">
                {lines.map((l) => {
                  const tier = tiersFor(event.slug).find(
                    (t) => t.id === l.tierId,
                  );
                  return (
                    <div
                      key={l.tierId}
                      className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line px-4 py-4 last:border-b-0"
                    >
                      <div className="min-w-[9rem] flex-1">
                        <p className="font-display text-[1.2rem]">
                          {l.tierName}
                        </p>
                        <p className="label mt-0.5 text-silverfaint">
                          {money(l.unitCents)} EACH
                          {l.admits > 1 && ` · ADMITS ${l.admits}`}
                        </p>
                      </div>
                      <QtyStepper
                        qty={l.qty}
                        max={tier ? maxSelectable(tier) : l.qty}
                        label={l.tierName}
                        onStep={(d) => adjustQty(event.slug, l.tierId, d)}
                      />
                      {/* ml-auto so that when the row wraps on a narrow phone
                          the line total still lands under the stepper. */}
                      <span className="label ml-auto w-16 text-right text-chalk">
                        {usd(l.unitCents * l.qty)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 border border-line p-4">
                <label htmlFor="promo" className="label text-silverfaint">
                  PROMO CODE
                </label>
                {promo ? (
                  <div className="mt-2 flex items-center justify-between gap-4 border border-[rgba(200,16,46,0.5)] px-3 py-2.5">
                    <span className="label text-bloodhi">
                      {promo.code} · {promo.label.toUpperCase()}
                    </span>
                    <button
                      onClick={() => setPromoCode(null)}
                      className="label text-silverfaint hover:text-chalk"
                    >
                      REMOVE
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="promo"
                        value={promoInput}
                        onChange={(e) => {
                          setPromoInput(e.target.value);
                          setPromoError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                        placeholder="Enter code"
                        className={`${field} min-w-0 flex-1 uppercase`}
                      />
                      <button
                        onClick={applyPromo}
                        disabled={!promoInput.trim()}
                        className={btn}
                      >
                        Apply
                      </button>
                    </div>
                    {promoError && (
                      <p className="label mt-2 text-bloodhi" role="alert">
                        {promoError.toUpperCase()}
                      </p>
                    )}
                    <p className="label mt-3 text-silverfaint">
                      DEMO CODES: {PROMOS.map((p) => p.code).join(" · ")}
                    </p>
                  </>
                )}
              </div>

              {gate ? (
                <div className="mt-6 border border-line p-5">
                  <p className="label mb-3 text-bloodhi">
                    {gate === "signin" ? "ACCOUNT REQUIRED" : "ID CHECK REQUIRED"}
                  </p>
                  <p className="text-sm leading-relaxed text-silverdim">
                    {gate === "signin"
                      ? "Tickets are tied to an account so they can be re-sent and checked at the door. Your order is held while you sign in."
                      : "Our nights are 18+. Verify your age once and you are cleared for every date after this one."}
                  </p>
                  <Link
                    href={gate === "signin" ? "/login" : "/verify"}
                    className={`${btnGo} mt-5 w-full`}
                  >
                    {gate === "signin" ? "Sign in to continue" : "Verify ID"}
                  </Link>
                </div>
              ) : (
                <button
                  onClick={() => setStep("details")}
                  className={`${btnGo} mt-6 w-full`}
                >
                  Continue to details
                </button>
              )}
            </section>
          )}

          {step === "details" && (
            <section>
              <h1 className="font-display chrome text-[clamp(1.9rem,5vw,3rem)] leading-[0.9]">
                Who is coming
              </h1>
              <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-silverdim">
                Tickets are issued to this name. Door staff check it against
                your ID, so use the one on the ID you are bringing.
              </p>

              <form
                className="mt-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  setTouched(true);
                  if (detailsOk) setStep("payment");
                }}
              >
                <div className="mb-4 flex flex-col gap-2">
                  <label htmlFor="c-name" className="label text-silverfaint">
                    FULL NAME
                  </label>
                  <input
                    id="c-name"
                    value={buyer.name}
                    onChange={(e) =>
                      setBuyer((b) => ({ ...b, name: e.target.value }))
                    }
                    autoComplete="name"
                    className={field}
                  />
                  {touched && !nameOk && (
                    <p className="label text-bloodhi" role="alert">
                      ENTER THE NAME ON YOUR ID
                    </p>
                  )}
                </div>

                <div className="mb-4 flex flex-col gap-2">
                  <label htmlFor="c-email" className="label text-silverfaint">
                    EMAIL
                  </label>
                  <input
                    id="c-email"
                    type="email"
                    value={buyer.email}
                    onChange={(e) =>
                      setBuyer((b) => ({ ...b, email: e.target.value }))
                    }
                    autoComplete="email"
                    className={field}
                  />
                  {touched && !emailOk && (
                    <p className="label text-bloodhi" role="alert">
                      ENTER A VALID EMAIL
                    </p>
                  )}
                </div>

                <div className="mb-6 flex flex-col gap-2">
                  <label htmlFor="c-phone" className="label text-silverfaint">
                    PHONE <span className="text-silverdim">(OPTIONAL)</span>
                  </label>
                  <input
                    id="c-phone"
                    type="tel"
                    value={buyer.phone}
                    onChange={(e) =>
                      setBuyer((b) => ({ ...b, phone: e.target.value }))
                    }
                    autoComplete="tel"
                    placeholder="For the location drop"
                    className={field}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("order")}
                    className={`${btn} flex-1`}
                  >
                    Back
                  </button>
                  <button type="submit" className={`${btnGo} flex-1`}>
                    {free ? "Continue" : "Continue to payment"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {step === "payment" && (
            <section>
              <h1 className="font-display chrome text-[clamp(1.9rem,5vw,3rem)] leading-[0.9]">
                {free ? "Confirm your spot" : "Payment"}
              </h1>

              {free ? (
                <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-silverdim">
                  Nothing to pay - this one is free entry. Confirm and your
                  tickets are issued straight away.
                </p>
              ) : (
                <>
                  <div className="label mt-6 border border-[rgba(200,16,46,0.5)] px-3 py-2.5 text-bloodhi">
                    TEST MODE · NO CARD IS CHARGED AND NO CARD DETAILS ARE TAKEN
                  </div>

                  <div className="mt-5 border border-line p-5">
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
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: "exp", label: "EXPIRY", value: "12 / 30" },
                        { id: "cvc", label: "CVC", value: "123" },
                        { id: "zip", label: "ZIP", value: "10012" },
                      ].map((f) => (
                        <div key={f.id} className="flex flex-col gap-2">
                          <label
                            htmlFor={f.id}
                            className="label text-silverfaint"
                          >
                            {f.label}
                          </label>
                          <input
                            id={f.id}
                            readOnly
                            value={f.value}
                            className={`${field} cursor-not-allowed text-silverdim`}
                          />
                        </div>
                      ))}
                    </div>
                    <p id="card-note" className="label mt-4 text-silverfaint">
                      FIXED TEST CARD. A LIVE BUILD HANDS THIS STEP TO STRIPE SO
                      NO CARD NUMBER EVER REACHES THIS SITE.
                    </p>
                  </div>
                </>
              )}

              <div className="label mt-5 flex justify-between border border-line px-3 py-3">
                <span className="text-silverfaint">
                  {totals.ticketCount}{" "}
                  {totals.ticketCount === 1 ? "TICKET" : "TICKETS"} ·{" "}
                  {totals.admitCount} IN
                </span>
                <span className="text-chalk">{usd(totals.totalCents)}</span>
              </div>

              {progress !== null && (
                <div className="mt-5">
                  <div className="h-1 w-full bg-line">
                    <div
                      className="h-full bg-blood transition-[width] duration-100"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="label mt-2 flex justify-between text-silverfaint">
                    <span>
                      {free ? "ISSUING TICKETS" : "AUTHORISING PAYMENT"}
                    </span>
                    <span>{progress}%</span>
                  </p>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setStep("details")}
                  disabled={progress !== null}
                  className={`${btn} flex-1`}
                >
                  Back
                </button>
                <button
                  onClick={() => setProgress(0)}
                  disabled={progress !== null}
                  className={`${btnGo} flex-1`}
                >
                  {progress !== null
                    ? "Working…"
                    : free
                      ? "Confirm RSVP"
                      : `Pay ${usd(totals.totalCents)}`}
                </button>
              </div>

              <p className="label mt-5 leading-loose text-silverfaint">
                BY COMPLETING THIS ORDER YOU AGREE TO THE 18+ DOOR POLICY.
                TICKETS ARE NON-REFUNDABLE ONCE THE LOCATION DROPS.
              </p>
            </section>
          )}
        </div>

        <Summary
          slug={event.slug}
          title={event.title}
          lines={lines}
          totals={totals}
          promoLabel={promo?.label}
          feeWaived={promo?.kind === "fees"}
        />
      </div>
    </Shell>
  );
}

/* ----------------------------------------------------------- confirmation -- */

function Confirmation({ order }: { order: Order }) {
  const ev = findEvent(order.eventSlug);

  const addToCalendar = () => {
    const ics = icsFor(order.eventSlug, order.id);
    if (!ics) return;
    const url = URL.createObjectURL(
      new Blob([ics], { type: "text/calendar;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${order.eventSlug}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Shell>
      <Progress step="done" />

      <div className="border border-line bg-ink p-6 sm:p-8">
        <p className="label text-bloodhi">ORDER {order.id}</p>
        <h1 className="font-display chrome mt-2 text-[clamp(2.25rem,7vw,4.5rem)] leading-[0.85]">
          You&rsquo;re in
        </h1>
        <p className="mt-3 max-w-[52ch] leading-relaxed text-silverdim">
          {order.passes.length === 1 ? "One ticket" : `${order.passes.length} tickets`}{" "}
          for {order.eventTitle}
          {ev && `, ${ev.dow} ${dayOf(ev.date)} ${monthOf(ev.date)}`}. A copy
          would land in {order.buyer.email} on a live build - here they live in
          your account, on this device.
        </p>

        <dl className="label mt-6 grid gap-x-8 gap-y-3 border-t border-line pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-silverfaint">PAID</dt>
            <dd className="mt-1 text-chalk">
              {order.totalCents === 0 ? "FREE ENTRY" : usd(order.totalCents)}
            </dd>
          </div>
          <div>
            <dt className="text-silverfaint">ADMITS</dt>
            <dd className="mt-1 text-chalk">
              {order.passes.reduce((n, p) => n + p.admits, 0)}
            </dd>
          </div>
          <div>
            <dt className="text-silverfaint">ISSUED TO</dt>
            <dd className="mt-1 break-words text-chalk">{order.buyer.name}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={addToCalendar} className={btn}>
            Add to calendar
          </button>
          <Link href="/account" className={btn}>
            My tickets
          </Link>
          <Link href="/tickets" className={btnGo}>
            Browse more dates
          </Link>
        </div>
      </div>

      <h2 className="font-display mt-10 mb-5 text-[2rem]">
        Your tickets
        <span className="label ml-3 align-middle text-silverfaint">
          SCAN AT THE DOOR
        </span>
      </h2>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {order.passes.map((p) => (
          <TicketPass
            key={p.code}
            pass={p}
            eventSlug={order.eventSlug}
            eventTitle={order.eventTitle}
            orderId={order.id}
          />
        ))}
      </div>
    </Shell>
  );
}
