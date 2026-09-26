"use client";

import { SITE_ORIGIN } from "@/lib/events";
import { claimUrl } from "@/lib/store";
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
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  return <TicketQr code={code} value={claimUrl(code, SITE_ORIGIN)} size={size} className={className} />;
}
