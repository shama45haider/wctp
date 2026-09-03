import { findEvent, monthOf, dayOf, SITE_ORIGIN } from "@/lib/events";
import { admitsOf, money } from "@/lib/tickets";
import type { Pass } from "@/lib/demo-account";
import { passUrl } from "@/lib/pass-token";
import TicketQr from "./TicketQr";

/**
 * One admission, drawn as a stub.
 *
 * The perforation sits between the identity half - which night, which tier -
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
      i: Date.parse(issuedAt) || Date.now(),
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
        <p className="label mt-1 text-silverdim">
          {ev ? `${ev.venue.toUpperCase()} · ${ev.time}` : "DETAILS TO FOLLOW"}
        </p>
        <p className="label mt-3 flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-chalk">{pass.tierName.toUpperCase()}</span>
          <span className="text-silverfaint">
            {admits === 1 ? "ADMITS ONE" : `ADMITS ${admits}`}
          </span>
        </p>
        <p className="label mt-2 text-silverfaint">
          <span className="text-silverdim">{guestName.toUpperCase()}</span>
        </p>
      </div>

      <div className="mt-auto border-t border-dashed border-linehi px-4 py-5">
        <TicketQr code={pass.code} value={url} size={qrSize} />
        <p className="label mt-3 text-center text-silverfaint">
          ORDER {orderId}
        </p>
      </div>
    </article>
  );
}
