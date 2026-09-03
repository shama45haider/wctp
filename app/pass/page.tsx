"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { findEvent, monthOf, dayOf } from "@/lib/events";
import { decodePass, type PassToken } from "@/lib/pass-token";

/**
 * Where a scanned ticket lands.
 *
 * The whole ticket rides in the URL fragment, so this page needs no network and
 * no account: door staff scan, the phone opens this, and the ticket is on the
 * screen. That also means it works on a venue's dead wifi, which is where a
 * lookup-based door check tends to fail.
 *
 * What this page can prove: the payload is internally consistent, and it names
 * the person it was issued to. What it cannot prove, without a server, is that
 * the same code is not also on somebody else's phone - see MARK AS USED below,
 * which is per-device by necessity.
 */

type State =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "bad"; reason: string }
  | { kind: "ok"; pass: PassToken };

/** Codes this device has already marked used tonight. */
const SCAN_KEY = "wctp.scanned";

function readScans(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SCAN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const REASONS: Record<string, string> = {
  unreadable: "This code could not be read.",
  tampered: "This ticket has been altered since it was issued.",
  version: "This ticket was issued by an older version of the site.",
};

export default function Pass() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [usedAt, setUsedAt] = useState<string | null>(null);

  // The fragment is client-only by design - it never reaches the host, which is
  // the point, since it carries a name.
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return setState({ kind: "empty" });

    const result = decodePass(raw);
    if (!result.ok) return setState({ kind: "bad", reason: result.reason });

    setState({ kind: "ok", pass: result.pass });
    setUsedAt(readScans()[result.pass.c] ?? null);
  }, []);

  const markUsed = (code: string) => {
    const now = new Date().toISOString();
    const scans = readScans();
    scans[code] = now;
    try {
      localStorage.setItem(SCAN_KEY, JSON.stringify(scans));
    } catch {
      // A locked-down browser can refuse storage; the check above still ran.
    }
    setUsedAt(now);
  };

  if (state.kind === "loading") {
    return (
      <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(3rem,10vw,6rem)]">
        <p className="label text-silverfaint">READING TICKET…</p>
      </main>
    );
  }

  if (state.kind === "empty" || state.kind === "bad") {
    const bad = state.kind === "bad";
    return (
      <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(3rem,10vw,6rem)] text-center">
        <span className="label border border-[rgba(200,16,46,0.5)] px-3 py-2 text-bloodhi">
          {bad ? "NOT VALID" : "NO TICKET"}
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          {bad ? "Do not admit" : "Nothing to show"}
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {bad
            ? REASONS[state.reason] ?? "This ticket could not be verified."
            : "Open this page by scanning the QR on a ticket."}
        </p>
        <Link
          href="/tickets"
          className="font-display mt-8 flex min-h-11 w-full items-center justify-center border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-6 py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim"
        >
          See the dates
        </Link>
      </main>
    );
  }

  const p = state.pass;
  const ev = findEvent(p.e);
  const used = usedAt !== null;

  return (
    <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,8vw,5rem)]">
      <span
        className={`label border px-3 py-2 ${
          used
            ? "border-[rgba(200,16,46,0.5)] text-bloodhi"
            : "border-line text-silverdim"
        }`}
      >
        {used ? "ALREADY USED" : "VALID TICKET"}
      </span>

      <h1 className="font-display chrome mt-6 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85] break-words">
        {p.n}
      </h1>

      <dl className="mt-7 border-t border-line">
        {[
          ["EVENT", ev?.title ?? p.e],
          [
            "WHEN",
            ev ? `${ev.dow} ${dayOf(ev.date)} ${monthOf(ev.date)} · ${ev.time}` : "—",
          ],
          ["WHERE", ev?.venue ?? "—"],
          ["TIER", p.t],
          ["ADMITS", String(p.a)],
          ["TICKET", p.c],
          ["ORDER", p.o],
        ].map(([k, v]) => (
          <div
            key={k}
            className="label flex items-baseline justify-between gap-4 border-b border-line py-3"
          >
            <dt className="text-silverfaint">{k}</dt>
            <dd className="text-right break-words text-chalk">{v}</dd>
          </div>
        ))}
      </dl>

      {used ? (
        <p className="label mt-6 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi">
          MARKED USED ON THIS DEVICE AT{" "}
          {new Date(usedAt).toLocaleString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            day: "numeric",
            month: "short",
          })}
        </p>
      ) : (
        <button
          onClick={() => markUsed(p.c)}
          className="font-display mt-7 w-full border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi"
        >
          Mark as used
        </button>
      )}
    </main>
  );
}
