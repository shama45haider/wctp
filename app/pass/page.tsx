"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { lookupPass, markPassUsed, type DoorLookup } from "@/lib/door";
import { findEvent, monthOf, dayOf } from "@/lib/events";
import { decodePass, type PassToken } from "@/lib/pass-token";
import { Editable } from "@/components/Editable";

/**
 * Where a scanned ticket lands.
 *
 * The whole ticket rides in the URL fragment, so this page needs no network and
 * no account: door staff scan, the phone opens this, and the ticket is on the
 * screen. That also means it works on the dead wifi at a door, which is where a
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

/**
 * The fragment, read as an external store.
 *
 * It is client-only by design - it never reaches the host, which is the point,
 * since it carries a name. The server snapshot is null, so the prerendered
 * page and the hydrating client both draw the loading state and agree with
 * each other; the ticket appears on the first render after that, without an
 * effect setting state to get there.
 */
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash.replace(/^#/, "");
const noHash = () => null;

export default function Pass() {
  const raw = useSyncExternalStore(subscribeHash, readHash, noHash);

  const state = useMemo<State>(() => {
    if (raw === null) return { kind: "loading" };
    if (!raw) return { kind: "empty" };
    const result = decodePass(raw);
    return result.ok
      ? { kind: "ok", pass: result.pass }
      : { kind: "bad", reason: result.reason };
  }, [raw]);

  // The moment this screen marked the ticket used, if it did; otherwise what
  // the device remembers from an earlier scan. Only ever read once there is a
  // ticket, which is only ever after hydration, so storage is never touched
  // in a render the server also produced.
  const [marked, setMarked] = useState<{ code: string; at: string } | null>(null);
  const usedAt = useMemo(() => {
    if (state.kind !== "ok") return null;
    if (marked?.code === state.pass.c) return marked.at;
    return readScans()[state.pass.c] ?? null;
  }, [state, marked]);

  // Staff signed in get the database's view of this pass: add-ons bought with
  // it, and whether any door has already let it in. Everyone else gets the
  // offline check above and nothing more.
  const { ready: authReady, isAdmin } = useSupabaseAuth();
  const staff = authReady && isAdmin;
  const passCode = state.kind === "ok" ? state.pass.c : null;
  const passOrder = state.kind === "ok" ? state.pass.o : null;
  const [door, setDoor] = useState<{
    code: string;
    data?: DoorLookup;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!staff || !passCode || !passOrder) return;
    let live = true;
    void lookupPass(passCode, passOrder).then((out) => {
      if (live) setDoor({ code: passCode, ...out });
    });
    return () => {
      live = false;
    };
  }, [staff, passCode, passOrder]);
  const doorNow = door && door.code === passCode ? door : null;
  const [markError, setMarkError] = useState<string | null>(null);

  const markUsed = (code: string) => {
    if (staff) {
      setMarkError(null);
      void markPassUsed(code).then((out) => {
        if (!out.ok) setMarkError(out.error ?? "Could not mark it used.");
        else if (doorNow?.data) {
          setDoor({ code, data: { ...doorNow.data, usedAt: out.at ?? null } });
        }
      });
    }
    const now = new Date().toISOString();
    const scans = readScans();
    scans[code] = now;
    try {
      localStorage.setItem(SCAN_KEY, JSON.stringify(scans));
    } catch {
      // A locked-down browser can refuse storage; the check above still ran.
    }
    setMarked({ code, at: now });
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
          {bad ? (
            <Editable k="pass.bad.badge">NOT VALID</Editable>
          ) : (
            <Editable k="pass.empty.badge">NO TICKET</Editable>
          )}
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          {bad ? (
            <Editable k="pass.bad.title">Do not admit</Editable>
          ) : (
            <Editable k="pass.empty.title">Nothing to show</Editable>
          )}
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {bad ? (
            REASONS[state.reason] ? (
              <Editable k={`pass.bad.reason.${state.reason}`}>
                {REASONS[state.reason]}
              </Editable>
            ) : (
              <Editable k="pass.bad.reason.fallback">
                This ticket could not be verified.
              </Editable>
            )
          ) : (
            <Editable k="pass.empty.blurb">
              Open this page by scanning the QR on a ticket.
            </Editable>
          )}
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
  const dbUsedAt = doorNow?.data?.usedAt ?? null;
  const used = usedAt !== null || dbUsedAt !== null;
  const shownUsedAt = dbUsedAt ?? usedAt;

  return (
    <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,8vw,5rem)]">
      <span
        className={`label border px-3 py-2 ${
          used
            ? "border-[rgba(200,16,46,0.5)] text-bloodhi"
            : "border-line text-silverdim"
        }`}
      >
        {used ? (
          <Editable k="pass.ok.alreadyUsed">ALREADY USED</Editable>
        ) : (
          <Editable k="pass.ok.valid">VALID TICKET</Editable>
        )}
      </span>

      <h1 className="font-display chrome mt-6 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85] break-words">
        {p.n}
      </h1>

      {/* Add-ons are the first thing the door needs after the name: what to
          hand over. Read from the order, never from the QR. */}
      {staff ? (
        <div
          className={`mt-6 border px-4 py-4 ${
            doorNow?.data?.addons.length
              ? "border-bloodhi bg-[rgba(200,16,46,0.08)]"
              : "border-line"
          }`}
        >
          <p className="label text-silverfaint">
            <Editable k="pass.door.addons">ADD-ONS</Editable>
          </p>
          {!doorNow ? (
            <p className="label mt-2 text-silverfaint">CHECKING…</p>
          ) : doorNow.error ? (
            <p className="label mt-2 text-bloodhi">{doorNow.error.toUpperCase()}</p>
          ) : !doorNow.data?.found ? (
            <p className="label mt-2 leading-loose text-bloodhi">
              <Editable k="pass.door.notFound">
                THIS PASS IS NOT IN THE DATABASE. CHECK THE NAME AGAINST THE LIST.
              </Editable>
            </p>
          ) : doorNow.data.addons.length === 0 ? (
            <p className="label mt-2 text-silverdim">
              <Editable k="pass.door.none">NONE</Editable>
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {doorNow.data.addons.map((a) => (
                <li key={a.name} className="font-display text-[1.6rem] leading-tight text-chalk">
                  {a.qty}&times; {a.name}
                </li>
              ))}
            </ul>
          )}
          {doorNow?.data?.cancelled && (
            <p className="label mt-3 text-bloodhi">
              <Editable k="pass.door.cancelled">THIS ORDER WAS CANCELLED</Editable>
            </p>
          )}
          {doorNow?.data?.found && !doorNow.data.paid && !doorNow.data.cancelled && (
            <p className="label mt-3 text-bloodhi">
              <Editable k="pass.door.unpaid">NOT MARKED PAID</Editable>
            </p>
          )}
        </div>
      ) : authReady ? (
        <p className="label mt-6 border border-line px-3 py-3 leading-loose text-silverfaint">
          <Editable k="pass.door.signIn">STAFF: SIGN IN TO SEE ADD-ONS AND DOOR STATUS.</Editable>
        </p>
      ) : null}

      <dl className="mt-7 border-t border-line">
        {([
          ["EVENT", ev?.title ?? p.e],
          [
            "WHEN",
            ev ? `${ev.dow} ${dayOf(ev.date)} ${monthOf(ev.date)} · ${ev.time}` : "—",
          ],
          [
            "WHERE",
            <Editable key="where" k="pass.details.whereValue">
              Emailed to the list
            </Editable>,
          ],
          ["TIER", p.t],
          ["ADMITS", String(p.a)],
          ["TICKET", p.c],
          ["ORDER", p.o],
        ] as const).map(([k, v]) => (
          <div
            key={k}
            className="label flex items-baseline justify-between gap-4 border-b border-line py-3"
          >
            <dt className="text-silverfaint">
              <Editable k={`pass.details.${k.toLowerCase()}`}>{k}</Editable>
            </dt>
            <dd className="text-right break-words text-chalk">{v}</dd>
          </div>
        ))}
      </dl>

      {markError && (
        <p className="label mt-6 text-bloodhi" role="alert">
          {markError.toUpperCase()}
        </p>
      )}

      {used && shownUsedAt ? (
        <p className="label mt-6 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi">
          {dbUsedAt ? (
            <Editable k="pass.ok.markedUsedDoor">LET IN AT</Editable>
          ) : (
            <Editable k="pass.ok.markedUsedAt">MARKED USED ON THIS DEVICE AT</Editable>
          )}{" "}
          {new Date(shownUsedAt).toLocaleString(undefined, {
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
