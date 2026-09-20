"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Flyer from "./Flyer";
import TicketPass from "./TicketPass";
import { Editable } from "./Editable";
import { findEvent, heroPhoto, monthOf, dayOf, org } from "@/lib/events";
import { atHandle } from "@/lib/handle";
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
          <Editable k={`checkout.step.${s.id}`}>{s.label}</Editable>
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
        <Editable k="checkout.empty.title">Your order is empty</Editable>
      </h1>
      <p className="mt-3 max-w-[46ch] text-silverdim">
        <Editable k="checkout.empty.blurb">
          Nothing is being held. Pick a night and choose your tickets - the order
          stays put while you sign in.
        </Editable>
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
      {ev && (heroPhoto(ev) || ev.imageId) && (
        <div className="relative aspect-[16/9] overflow-hidden border-b border-line">
          <Flyer
            id={ev.imageId}
            src={heroPhoto(ev) ?? undefined}
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
            {ev.dow} {dayOf(ev.date)} {monthOf(ev.date)} · {ev.time}
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
          <dt>
            <Editable k="checkout.summary.subtotal">SUBTOTAL</Editable>
          </dt>
          <dd className="text-chalk">{usd(totals.subtotalCents)}</dd>
        </div>

        {totals.discountCents > 0 && (
          <div className="label mt-2 flex justify-between text-bloodhi">
            <dt>
              {promoLabel ? (
                promoLabel.toUpperCase()
              ) : (
                <Editable k="checkout.summary.discount">DISCOUNT</Editable>
              )}
            </dt>
            <dd>&minus;{usd(totals.discountCents)}</dd>
          </div>
        )}

        {/* An all-free order never had a fee, so "waived" would be a boast
            about nothing. The row only appears when there is a fee, or when a
            code actually took one away. */}
        {(totals.feeCents > 0 || feeWaived) && (
          <div className="label mt-2 flex justify-between text-silverdim">
            <dt>
              <Editable k="checkout.summary.serviceFee">SERVICE FEE</Editable>
            </dt>
            <dd className={feeWaived ? "text-bloodhi" : ""}>
              {feeWaived ? (
                <Editable k="checkout.summary.feeWaived">WAIVED</Editable>
              ) : (
                usd(totals.feeCents)
              )}
            </dd>
          </div>
        )}

        <div className="font-display mt-4 flex justify-between border-t border-line pt-4 text-[1.65rem]">
          <dt>
            <Editable k="checkout.summary.total">Total</Editable>
          </dt>
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
  // every render would fight anyone editing the email they want the address
  // sent to. "Once" has to mean once the profile is in: before that the name
  // is the email's local part standing in for a handle that has not arrived.
  useEffect(() => {
    if (prefilled.current || !user?.profileLoaded) return;
    prefilled.current = true;
    setBuyer({
      name: user.instagram ? atHandle(user.name) : user.name,
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

  // A ticket is issued to the account's handle when it has one; the field
  // showing it is read-only, so this is the same value, taken from the source
  // rather than from a copy that was made when the page opened.
  const ticketName = user?.instagram ? atHandle(user.name) : buyer.name.trim();

  const settle = () => {
    const placed = placeOrder(
      {
        name: ticketName,
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

  // A donation is a gift, not an admission: no account to attach it to and
  // nobody's age to check. Only tickets go through the gate.
  const donationOnly = totals.ticketCount === 0 && totals.donationCents > 0;
  const gate = donationOnly
    ? null
    : !user
      ? "signin"
      : !user.verified
        ? "verify"
        : null;
  const pending = user?.check?.status === "pending";
  const nameOk = ticketName.length > 1;
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
                <Editable k="checkout.order.title">Your order</Editable>
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
                          {l.donation ? (
                            <Editable k="checkout.order.giftNote">
                              GIFT · NO FEE, NO TICKET
                            </Editable>
                          ) : (
                            <>
                              {money(l.unitCents)}{" "}
                              <Editable k="checkout.order.each">EACH</Editable>
                            </>
                          )}
                          {l.admits > 1 && (
                            <>
                              {" · "}
                              <Editable k="checkout.order.admits">ADMITS</Editable>{" "}
                              {l.admits}
                            </>
                          )}
                        </p>
                      </div>
                      {l.donation ? (
                        <Link
                          href={`/events/${event.slug}#tickets`}
                          className="label flex min-h-11 items-center border border-line px-3 text-silverdim transition-colors hover:border-linehi hover:text-chalk"
                        >
                          CHANGE
                        </Link>
                      ) : (
                        <QtyStepper
                          qty={l.qty}
                          max={tier ? maxSelectable(tier) : l.qty}
                          label={l.tierName}
                          onStep={(d) => adjustQty(event.slug, l.tierId, d)}
                        />
                      )}
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
                  <Editable k="checkout.promo.label">PROMO CODE</Editable>
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
                      <Editable k="checkout.promo.demoCodes">DEMO CODES:</Editable>{" "}
                      {PROMOS.map((p) => p.code).join(" · ")}
                    </p>
                  </>
                )}
              </div>

              {gate ? (
                <div className="mt-6 border border-line p-5">
                  <p className="label mb-3 text-bloodhi">
                    {gate === "signin" ? (
                      <Editable k="checkout.gate.signinLabel">SIGN IN TO RSVP</Editable>
                    ) : (
                      <Editable k="checkout.gate.verifyLabel">AGE CHECK REQUIRED</Editable>
                    )}
                  </p>
                  <p className="text-sm leading-relaxed text-silverdim">
                    {gate === "signin" ? (
                      <Editable k="checkout.gate.signinBlurb">
                        {"Tickets attach to an account, and every account has its age checked once. Your selection stays here while you sign in."}
                      </Editable>
                    ) : pending ? (
                      <Editable k="checkout.gate.pendingBlurb">
                        {`Your ID is with us. A person reads every one, so give it a little time - you'll hear from ${org.email}, and you can RSVP the moment it's approved.`}
                      </Editable>
                    ) : (
                      <Editable k="checkout.gate.verifyBlurb">
                        {"Our nights are 18+. Send a photo of your ID once and you're cleared for every date after this one."}
                      </Editable>
                    )}
                  </p>
                  <Link
                    href={gate === "signin" ? "/login" : "/verify"}
                    className={`${btnGo} mt-5 w-full`}
                  >
                    {gate === "signin"
                      ? "Sign in"
                      : pending
                        ? "See where it's at"
                        : "Verify your age"}
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
                <Editable k="checkout.details.title">Who is coming</Editable>
              </h1>
              <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-silverdim">
                <Editable k="checkout.details.blurb">
                  {`Tickets carry the name below - it’s what the door reads. The address for the night is emailed from ${org.email} to the email you give here, so make it one you read.`}
                </Editable>
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
                    <Editable k="checkout.details.nameLabel">NAME ON THE TICKET</Editable>
                  </label>
                  {user?.instagram ? (
                    <>
                      <input
                        id="c-name"
                        readOnly
                        value={ticketName}
                        aria-describedby="c-name-note"
                        className={`${field} cursor-not-allowed text-silverdim`}
                      />
                      <p id="c-name-note" className="text-sm text-silverfaint">
                        <Editable k="checkout.details.handleNote">
                          Tickets are issued to your Instagram handle - it&rsquo;s
                          what the door reads. Change it on
                        </Editable>{" "}
                        <Link
                          href="/profile"
                          className="underline hover:text-chalk"
                        >
                          your profile
                        </Link>
                        .
                      </p>
                    </>
                  ) : (
                    <input
                      id="c-name"
                      value={buyer.name}
                      onChange={(e) =>
                        setBuyer((b) => ({ ...b, name: e.target.value }))
                      }
                      autoComplete="name"
                      className={field}
                    />
                  )}
                  {touched && !nameOk && (
                    <p className="label text-bloodhi" role="alert">
                      ENTER THE NAME ON YOUR ID
                    </p>
                  )}
                </div>

                <div className="mb-4 flex flex-col gap-2">
                  <label htmlFor="c-email" className="label text-silverfaint">
                    <Editable k="checkout.details.emailLabel">EMAIL</Editable>
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
                    <Editable k="checkout.details.phoneLabel">PHONE</Editable>{" "}
                    <span className="text-silverdim">
                      <Editable k="checkout.details.optional">(OPTIONAL)</Editable>
                    </span>
                  </label>
                  <input
                    id="c-phone"
                    type="tel"
                    value={buyer.phone}
                    onChange={(e) =>
                      setBuyer((b) => ({ ...b, phone: e.target.value }))
                    }
                    autoComplete="tel"
                    placeholder="Only if something changes on the night"
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
                {free ? (
                  <Editable k="checkout.payment.freeTitle">Confirm your spot</Editable>
                ) : (
                  <Editable k="checkout.payment.title">Payment</Editable>
                )}
              </h1>

              {free ? (
                <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-silverdim">
                  <Editable k="checkout.payment.freeBlurb">
                    Nothing to pay - this one is free entry. Confirm and your
                    tickets are issued straight away.
                  </Editable>
                </p>
              ) : (
                <>
                  <div className="label mt-6 border border-[rgba(200,16,46,0.5)] px-3 py-2.5 text-bloodhi">
                    <Editable k="checkout.payment.testMode">
                      TEST MODE · NO CARD IS CHARGED AND NO CARD DETAILS ARE TAKEN
                    </Editable>
                  </div>

                  <div className="mt-5 border border-line p-5">
                    <div className="mb-4 flex flex-col gap-2">
                      <label htmlFor="card" className="label text-silverfaint">
                        <Editable k="checkout.payment.cardLabel">CARD NUMBER</Editable>
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
                            <Editable k={`checkout.payment.${f.id}Label`}>
                              {f.label}
                            </Editable>
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
                      <Editable k="checkout.payment.cardNote">
                        FIXED TEST CARD. A LIVE BUILD HANDS THIS STEP TO STRIPE SO
                        NO CARD NUMBER EVER REACHES THIS SITE.
                      </Editable>
                    </p>
                  </div>
                </>
              )}

              <div className="label mt-5 flex justify-between border border-line px-3 py-3">
                <span className="text-silverfaint">
                  {donationOnly ? (
                    <Editable k="checkout.payment.donation">DONATION</Editable>
                  ) : (
                    <>
                      {totals.ticketCount}{" "}
                      {totals.ticketCount === 1 ? (
                        <Editable k="checkout.payment.ticket">TICKET</Editable>
                      ) : (
                        <Editable k="checkout.payment.tickets">TICKETS</Editable>
                      )}
                      {` · ${totals.admitCount} `}
                      <Editable k="checkout.payment.in">IN</Editable>
                    </>
                  )}
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
                      {free
                        ? "ISSUING TICKETS"
                        : donationOnly
                          ? "SENDING DONATION"
                          : "AUTHORISING PAYMENT"}
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
                      : donationOnly
                        ? `Give ${usd(totals.totalCents)}`
                        : `Pay ${usd(totals.totalCents)}`}
                </button>
              </div>

              <p className="label mt-5 leading-loose text-silverfaint">
                {donationOnly ? (
                  <Editable k="checkout.payment.donationTerms">
                    {"DONATIONS SUPPORT SOUND, LIGHTS AND THE NEXT DATE. THEY ARE NOT A TICKET AND DO NOT HOLD A SPOT."}
                  </Editable>
                ) : (
                  <Editable k="checkout.payment.orderTerms">
                    {"BY COMPLETING THIS ORDER YOU AGREE TO THE 18+ DOOR POLICY. TICKETS ARE NON-REFUNDABLE ONCE THE ADDRESS HAS BEEN EMAILED."}
                  </Editable>
                )}
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
  /** Nothing was admitted, so this is a receipt for a gift rather than a ticket. */
  const gift = order.passes.length === 0;

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
        <p className="label text-bloodhi">
          <Editable k="checkout.done.orderLabel">ORDER</Editable> {order.id}
        </p>
        <h1 className="font-display chrome mt-2 text-[clamp(2.25rem,7vw,4.5rem)] leading-[0.85]">
          {gift ? (
            <Editable k="checkout.done.giftTitle">Thank you</Editable>
          ) : (
            <Editable k="checkout.done.title">You’re in</Editable>
          )}
        </h1>
        <p className="mt-3 max-w-[52ch] leading-relaxed text-silverdim">
          {gift ? (
            <>
              <Editable k="checkout.done.giftYour">Your</Editable>{" "}
              {usd(order.totalCents)}{" "}
              <Editable k="checkout.done.giftInto">goes straight into</Editable>{" "}
              {order.eventTitle}
              {ev && `, ${ev.dow} ${dayOf(ev.date)} ${monthOf(ev.date)}`}.{" "}
              <Editable k="checkout.done.giftNote">
                This is a gift, not a ticket - it does not hold you a spot, so
                grab one when sales open.
              </Editable>
            </>
          ) : (
            <>
              {order.passes.length === 1 ? (
                <Editable k="checkout.done.oneTicket">One ticket</Editable>
              ) : (
                <>
                  {order.passes.length}{" "}
                  <Editable k="checkout.done.tickets">tickets</Editable>
                </>
              )}{" "}
              <Editable k="checkout.done.for">for</Editable> {order.eventTitle}
              {ev && `, ${ev.dow} ${dayOf(ev.date)} ${monthOf(ev.date)}`}.{" "}
              <Editable k="checkout.done.copyWouldLand">A copy would land in</Editable>{" "}
              {order.buyer.email}{" "}
              <Editable k="checkout.done.liveBuildNote">
                {`on a live build - here they live in your account, on this device. The address is emailed from ${org.email} to`}
              </Editable>{" "}
              {order.buyer.email}{" "}
              <Editable k="checkout.done.beforeNight">before the night.</Editable>
            </>
          )}
        </p>

        <dl className="label mt-6 grid gap-x-8 gap-y-3 border-t border-line pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-silverfaint">
              {gift ? (
                <Editable k="checkout.done.givenLabel">GIVEN</Editable>
              ) : (
                <Editable k="checkout.done.paidLabel">PAID</Editable>
              )}
            </dt>
            <dd className="mt-1 text-chalk">
              {order.totalCents === 0 ? (
                <Editable k="checkout.done.freeEntry">FREE ENTRY</Editable>
              ) : (
                usd(order.totalCents)
              )}
            </dd>
          </div>
          {!gift && (
            <div>
              <dt className="text-silverfaint">
                <Editable k="checkout.done.admitsLabel">ADMITS</Editable>
              </dt>
              <dd className="mt-1 text-chalk">
                {order.passes.reduce((n, p) => n + p.admits, 0)}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-silverfaint">
              {gift ? (
                <Editable k="checkout.done.fromLabel">FROM</Editable>
              ) : (
                <Editable k="checkout.done.issuedToLabel">ISSUED TO</Editable>
              )}
            </dt>
            <dd className="mt-1 break-words text-chalk">{order.buyer.name}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={addToCalendar} className={btn}>
            Add to calendar
          </button>
          {!gift && (
            <Link href="/account" className={btn}>
              My tickets
            </Link>
          )}
          <Link href="/tickets" className={btnGo}>
            Browse more dates
          </Link>
        </div>
      </div>

      {order.passes.length > 0 && (
        <>
          <h2 className="font-display mt-10 mb-5 text-[2rem]">
            <Editable k="checkout.done.ticketsTitle">Your tickets</Editable>
            <span className="label ml-3 align-middle text-silverfaint">
              <Editable k="checkout.done.scanAtDoor">SCAN AT THE DOOR</Editable>
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
                guestName={order.buyer.name}
                issuedAt={order.createdAt}
              />
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}
