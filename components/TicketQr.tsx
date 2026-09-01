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
 * The payload is the raw ticket code rather than a URL, so door staff can scan
 * and match it with no signal in the venue.
 */
export default function TicketQr({
  code,
  size = 148,
  className = "",
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="bg-[#f2f4f7] p-3">
        <QRCodeSVG
          value={code}
          size={size}
          level="Q"
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
