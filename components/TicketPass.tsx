import { findEvent, monthOf, dayOf, SITE_ORIGIN } from "@/lib/events";
import { admitsOf, money } from "@/lib/tickets";
import type { Pass } from "@/lib/demo-account";
import { passUrl } from "@/lib/pass-token";
import Link from "next/link";
import TicketQr from "./TicketQr";
import { Editable } from "./Editable";

/**
 * One admission, drawn as a stub.
 *
 * The perforation sits between the readable half - which night, which tier -
 * and the scannable half, so a phone held up at the door shows door staff the
 * code and the name of the tier it belongs to in the same glance.
 */
export default function TicketPass({
  pass,
  eventSlug,
  eventTitle,
  orderId,
  guestName,
  issuedAt,
  qrSize = 156,
  locked = false,
}: {
  pass: Pass;
  eventSlug: string;
  eventTitle: string;
  orderId: string;
  /** Who the ticket is for. Travels inside the QR so the door sees it. */
  guestName: string;
  /** ISO string from the order. */
  issuedAt: string;
  qrSize?: number;
  /**
   * The ticket is bought but the account has not been verified by staff yet.
   * The stub still shows what was bought; the QR and its code stay hidden, so
   * there is nothing to scan or screenshot until a person has checked the ID.
   */
  locked?: boolean;
}) {
  const ev = findEvent(eventSlug);
  const admits = admitsOf(pass);
  const url = passUrl(
    {
      c: pass.code,
      n: guestName,
      e: eventSlug,
      t: pass.tierName,
      a: admits,
      o: orderId,
      // Zero for a timestamp that will not parse, rather than "now": the
      // value only ever rides in the QR, and a clock read during render would
      // change the digest on every re-render of the same ticket.
      i: Date.parse(issuedAt) || 0,
    },
    SITE_ORIGIN,
  );

  return (
    <article className="flex flex-col border border-line bg-ink">
      <div className="label flex items-center justify-between border-b border-line px-4 py-2.5 text-silverfaint">
        <span>{ev ? `${ev.dow} ${dayOf(ev.date)} ${monthOf(ev.date)}` : ""}</span>
        <span className="text-bloodhi">{money(pass.priceCents)}</span>
      </div>

      <div className="px-4 pt-4 pb-3">
        <h3 className="font-display text-[1.35rem] break-words">{eventTitle}</h3>
        {/* The time, never the place. A ticket gets screenshotted and passed
            around; the address only ever goes out by email to the list. */}
        <p className="label mt-1 text-silverdim">
          {ev ? (
            <>
              {`${ev.time} · `}
              <Editable k="ticketPass.addressByEmail">ADDRESS BY EMAIL</Editable>
            </>
          ) : (
            <Editable k="ticketPass.detailsToFollow">DETAILS TO FOLLOW</Editable>
          )}
        </p>
        <p className="label mt-3 flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-chalk">{pass.tierName.toUpperCase()}</span>
          <span className="text-silverfaint">
            {admits === 1 ? (
              <Editable k="ticketPass.admitsOne">ADMITS ONE</Editable>
            ) : (
              <>
                <Editable k="ticketPass.admitsLabel">ADMITS</Editable> {admits}
              </>
            )}
          </span>
        </p>
        <p className="label mt-2 text-silverfaint">
          <span className="text-silverdim">{guestName.toUpperCase()}</span>
        </p>
      </div>

      <div className="mt-auto border-t border-dashed border-linehi px-4 py-5">
        {locked ? (
          <div className="flex flex-col items-center gap-3 border border-blood bg-[rgba(229,37,46,0.06)] px-4 py-6 text-center">
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" className="text-bloodhi" fill="currentColor">
              <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Z" />
            </svg>
            <p className="text-[0.9375rem] font-medium text-chalk">
              <Editable k="ticketPass.locked.title">QR locked until you&rsquo;re verified</Editable>
            </p>
            <p className="text-[0.8125rem] leading-relaxed text-silverdim">
              <Editable k="ticketPass.locked.body">
                Your ticket is saved. Staff check your ID, then the QR shows up here.
              </Editable>
            </p>
            <Link
              href="/verify"
              className="inline-flex min-h-10 items-center rounded-full bg-blood px-4 text-[0.8125rem] font-medium text-white hover:bg-bloodhi"
            >
              Verify my account
            </Link>
          </div>
        ) : (
          <TicketQr code={pass.code} value={url} size={qrSize} />
        )}
        <p className="label mt-3 text-center text-silverfaint">
          <Editable k="ticketPass.orderLabel">ORDER</Editable> {orderId}
        </p>
      </div>
    </article>
  );
}
