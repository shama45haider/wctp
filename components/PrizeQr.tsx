"use client";

import { SITE_ORIGIN } from "@/lib/events";
import { claimUrl } from "@/lib/store";
import Link from "next/link";
import TicketQr from "./TicketQr";

/**
 * The QR a buyer shows at the next event to pick up a prize. It opens /claim
 * on the live site with the code in the fragment; a staff member signed in to
 * the dashboard sees who bought it and taps HAND OVER. Always the live origin,
 * never the one this page is on, so a QR shown from a dev build still scans
 * to somewhere staff are signed in.
 */
export default function PrizeQr({
  code,
  size = 176,
  className = "",
  locked = false,
}: {
  code: string;
  size?: number;
  className?: string;
  /**
   * Bought, but the account is not verified by staff yet: the QR and its code
   * stay hidden, so there is nothing to show at pickup until ID is checked.
   */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <div
        className={`flex flex-col items-center gap-3 border border-blood bg-[rgba(229,37,46,0.06)] px-4 py-6 text-center ${className}`}
        style={{ maxWidth: Math.max(size + 64, 220) }}
      >
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" className="text-bloodhi" fill="currentColor">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Z" />
        </svg>
        <p className="text-[0.9375rem] font-medium text-chalk">Pickup QR locked until you&rsquo;re verified</p>
        <p className="text-[0.8125rem] leading-relaxed text-silverdim">
          Your prize is reserved. Staff check your ID, then the QR shows up here.
        </p>
        <Link
          href="/verify"
          className="inline-flex min-h-10 items-center rounded-full bg-blood px-4 text-[0.8125rem] font-medium text-white hover:bg-bloodhi"
        >
          Verify my account
        </Link>
      </div>
    );
  }
  return <TicketQr code={code} value={claimUrl(code, SITE_ORIGIN)} size={size} className={className} />;
}
