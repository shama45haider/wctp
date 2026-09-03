"use client";

import { QRCodeSVG } from "qrcode.react";

/**
 * Ticket QR.
 *
 * Deliberately dark-on-light with a quiet zone: inverted QR codes are rejected
 * by a meaningful share of phone scanners, and a ticket that won't scan at a
 * dark door is worse than no QR at all. The white stub reads as a torn ticket
 * against the page, so it earns its contrast.
 *
 * `value` is a full https://…/pass#… URL, so any phone camera opens the ticket
 * without an app. Error correction sits at M rather than Q on purpose: the
 * payload carries the whole ticket, and at Q the extra recovery data pushes the
 * grid dense enough that a phone struggles at this size. These are read off a
 * clean screen, where density is the real risk and abrasion is not.
 */
export default function TicketQr({
  code,
  value,
  size = 156,
  className = "",
}: {
  /** Shown under the code. Also the fallback payload if no URL is given. */
  code: string;
  /** What the QR actually encodes. Defaults to the bare code. */
  value?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="bg-[#f2f4f7] p-3">
        <QRCodeSVG
          value={value ?? code}
          size={size}
          level="M"
          marginSize={2}
          bgColor="#f2f4f7"
          fgColor="#050505"
          title={`Ticket ${code}`}
        />
      </div>
      <p className="label mt-3 tracking-[0.14em] text-chalk">{code}</p>
    </div>
  );
}
