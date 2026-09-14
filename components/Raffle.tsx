"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Editable } from "./Editable";
import { org } from "@/lib/events";
import { useOwnProfile } from "@/lib/profile-data";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { enterRaffle, loadRaffle, type RaffleState } from "@/lib/raffle";

/**
 * The members' raffle: a box that opens on the first visit, and a floating
 * bubble bottom-right once it has been closed. The raffle itself - title,
 * prizes, whether it's on the site or taking entries - is set in the admin
 * dashboard; entry rules live in the database (0015/0016). The button here
 * only explains which rule a guest hasn't met yet and sends them to fix it.
 *
 * Renders nothing until the raffle has loaded - whether the box has been
 * seen is in localStorage, which the static export can't know - and nothing
 * on the pages someone is sent to in order to become eligible, so it never
 * sits on top of the sign-up or ID upload it just asked for.
 */

const HIDDEN_ON = ["/admin", "/pass", "/signup", "/login", "/verify", "/checkout", "/raffle"];
const TONES = ["gold", "silver", "bronze"];
const seenKey = (raffleId: string) => `wctp.raffle.${raffleId}.seen`;

const CTA =
  "raffle-cta font-display flex min-h-14 w-full items-center justify-center gap-2 px-5 text-[1.25rem] tracking-[0.1em] uppercase transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

export function TicketIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 7.5a2 2 0 0 0 2-2h13a2 2 0 0 0 2 2v2.75a1.75 1.75 0 0 0 0 3.5v2.75a2 2 0 0 0-2 2h-13a2 2 0 0 0-2-2v-2.75a1.75 1.75 0 0 0 0-3.5z" />
      <path d="M14.5 6v2M14.5 11v2M14.5 16v2" />
    </svg>
  );
}

function Status({
  title,
  body,
  win = false,
}: {
  title: React.ReactNode;
  body: React.ReactNode;
  win?: boolean;
}) {
  return (
    <div
      className={`border px-4 py-3.5 ${
        win ? "border-[rgba(246,226,122,0.55)] bg-[rgba(246,226,122,0.06)]" : "border-linehi bg-ink2"
      }`}
    >
      <p
        className={`font-display text-[1.625rem] leading-none uppercase ${win ? "raffle-gold" : "text-chalk"}`}
      >
        {title}
      </p>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-silverdim">{body}</p>
    </div>
  );
}

export default function Raffle() {
  const pathname = usePathname() ?? "/";
  const { ready, user } = useSupabaseAuth();
  const { profile, loaded, reload: reloadProfile } = useOwnProfile(user?.id);

  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RaffleState | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const userId = user?.id;
  useEffect(() => {
    let live = true;
    void loadRaffle(userId).then((next) => {
      if (live) setData(next);
    });
    return () => {
      live = false;
    };
  }, [userId, tick]);

  // Nothing at all when there's no raffle to show - a box holding a database
  // error is worse than no box.
  const raffle = data && !data.missing ? data.raffle : null;
  const raffleId = raffle?.id ?? null;

  // First sight of a raffle: the box opens after a beat. After it's been
  // closed once, every later visit starts with just the bubble. A new raffle
  // has a new id, so it opens for everyone again.
  useEffect(() => {
    if (!raffleId) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(seenKey(raffleId)) === "1";
    } catch {}
    if (seen) return;
    const timer = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(timer);
  }, [raffleId]);

  const hidden = HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const showing = !hidden && raffle !== null;
  const boxOpen = showing && open;

  const close = useCallback(() => {
    setOpen(false);
    setProblem(null);
    if (!raffleId) return;
    try {
      window.localStorage.setItem(seenKey(raffleId), "1");
    } catch {}
  }, [raffleId]);

  const reopen = () => {
    setOpen(true);
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (!boxOpen) return;
    dialog.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [boxOpen, close]);

  if (!showing || !data || !raffle) return null;

  const signedIn = ready && Boolean(user);
  const checking = !ready || (signedIn && !loaded);
  const verified = Boolean(profile?.verified);
  const pending = !verified && profile?.latestCheck?.status === "pending";
  const count = data.entrants.length;
  const myHandle = profile?.instagram?.toLowerCase() ?? null;

  const titleWords = raffle.title.trim().split(/\s+/);
  const titleLead = titleWords.length > 1 ? titleWords.slice(0, -1).join(" ") : "";
  const titleLast = titleWords[titleWords.length - 1] ?? "";
  const prizes = raffle.prizes.filter((p) => p.place || p.items.length > 0);

  const enter = async () => {
    if (!user) return;
    setBusy(true);
    setProblem(null);
    const out = await enterRaffle(raffle.id, user.id);
    setBusy(false);
    if (!out.ok) {
      setProblem(out.error ?? "That didn't go through.");
      reloadProfile();
      return;
    }
    setData((d) => (d ? { ...d, entered: true } : d));
    setTick((t) => t + 1);
  };

  let cta: React.ReactNode;
  if (checking) {
    cta = (
      <button type="button" disabled className={CTA}>
        Checking…
      </button>
    );
  } else if (data.entered) {
    cta = (
      <Status
        win
        title={<Editable k="raffle.status.in.title">You&rsquo;re in</Editable>}
        body={
          <Editable k="raffle.status.in.body">
            {`Good luck. Winners are drawn at random and announced on ${org.instagramHandle}.`}
          </Editable>
        }
      />
    );
  } else if (!raffle.open) {
    cta = (
      <Status
        title={<Editable k="raffle.status.closed.title">Entries closed</Editable>}
        body={
          <Editable k="raffle.status.closed.body">
            {`Winners are announced on ${org.instagramHandle}.`}
          </Editable>
        }
      />
    );
  } else if (!signedIn) {
    cta = (
      <div className="flex flex-col items-center gap-1">
        <Link href="/signup" onClick={close} className={CTA}>
          <TicketIcon className="h-5 w-5" />
          Verify your ID to enter
        </Link>
        <Link
          href="/login"
          onClick={close}
          className="label flex min-h-11 items-center text-silverdim transition-colors hover:text-chalk"
        >
          ALREADY VERIFIED? SIGN IN
        </Link>
      </div>
    );
  } else if (pending) {
    cta = (
      <Status
        title={<Editable k="raffle.status.review.title">ID in review</Editable>}
        body={
          <Editable k="raffle.status.review.body">
            A person checks every ID by hand. You can enter the moment yours is approved.
          </Editable>
        }
      />
    );
  } else if (!verified) {
    cta = (
      <Link href="/verify" onClick={close} className={CTA}>
        <TicketIcon className="h-5 w-5" />
        Upload your ID to enter
      </Link>
    );
  } else {
    cta = (
      <button type="button" onClick={() => void enter()} disabled={busy} className={CTA}>
        <TicketIcon className="h-5 w-5" />
        {busy ? "Entering…" : "Enter the raffle"}
      </button>
    );
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={reopen}
          aria-label={`Open the raffle - ${count} entered`}
          className="raffle-bubble fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[8990] lg:right-6 lg:bottom-6"
        >
          <span className="flex min-h-12 items-center gap-2.5 rounded-full bg-void py-1.5 pr-4 pl-1.5">
            <span className="raffle-coin flex h-9 w-9 items-center justify-center rounded-full text-void">
              <TicketIcon className="h-5 w-5" />
            </span>
            <span className="font-display text-[1.0625rem] leading-none tracking-[0.1em] text-chalk uppercase">
              {data.entered ? "You're in" : "Raffle"}
            </span>
            {!data.error && (
              <span className="font-mono text-[0.6875rem] text-silverdim">{count} IN</span>
            )}
          </span>
        </button>
      )}

      {open && (
        <div
          className="raffle-backdrop fixed inset-0 z-[9000] flex items-end justify-center bg-void/80 backdrop-blur-md sm:items-center sm:p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="raffle-ring flex max-h-[92dvh] w-full sm:max-w-[34rem]">
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="raffle-title"
              tabIndex={-1}
              className="w-full overflow-y-auto overscroll-contain bg-ink outline-none"
            >
              {/* ------------------------------------------------ header -- */}
              <div className="relative overflow-hidden px-5 pt-6 pb-6 sm:px-7 sm:pt-7">
                <div
                  aria-hidden="true"
                  className="raffle-glow pointer-events-none absolute -top-28 left-1/2 h-64 w-[150%] -translate-x-1/2"
                />

                <button
                  type="button"
                  onClick={close}
                  aria-label="Close the raffle"
                  className="absolute top-2 right-2 z-10 flex h-11 w-11 items-center justify-center text-silverdim transition-colors hover:text-chalk"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>

                <div className="relative flex items-center gap-2">
                  <span className="dot shrink-0" />
                  <span className="label text-bloodhi">
                    <Editable k="raffle.eyebrow">VERIFIED MEMBERS ONLY · FREE ENTRY</Editable>
                  </span>
                </div>

                <h2
                  id="raffle-title"
                  className="font-display relative mt-4 text-[clamp(2.75rem,13vw,4.5rem)] leading-[0.82] tracking-[-0.02em] break-words"
                >
                  {titleLead && <span className="chrome block">{titleLead}</span>}
                  <span className="raffle-gold block">{titleLast}</span>
                </h2>

                {raffle.blurb && (
                  <p className="relative mt-4 max-w-[36ch] text-[0.9375rem] leading-relaxed text-silverdim">
                    {raffle.blurb}
                  </p>
                )}
              </div>

              {/* ------------------------------------------------ prizes -- */}
              {prizes.length > 0 && (
                <ol className="border-t border-line">
                  {prizes.map((p, i) => (
                    <li
                      key={i}
                      className={`flex items-center gap-4 border-b border-line px-5 py-4 sm:px-7 ${
                        i === 0 ? "bg-[linear-gradient(90deg,rgba(246,226,122,0.08),transparent_70%)]" : ""
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`raffle-${TONES[i] ?? "silver"} font-display w-12 shrink-0 text-center text-[3.25rem] leading-[0.85]`}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        {p.place && <p className="label text-silverfaint">{p.place}</p>}
                        {p.items.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {p.items.map((item, j) => (
                              <li
                                key={j}
                                className={`border px-2.5 py-1 text-[0.875rem] leading-snug ${
                                  i === 0
                                    ? "border-[rgba(246,226,122,0.45)] text-chalk"
                                    : "border-linehi text-silver"
                                }`}
                              >
                                {item}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {/* ---------------------------------------------- entrants -- */}
              <div className="px-5 py-4 sm:px-7">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="label text-silverfaint">
                    <Editable k="raffle.entrants.title">WHO&rsquo;S IN</Editable>
                  </p>
                  <p className="font-display text-[1.75rem] leading-none text-chalk">
                    {data.error ? "–" : count}
                  </p>
                </div>

                {data.error ? (
                  <p className="label mt-3 leading-loose text-bloodhi">{data.error.toUpperCase()}</p>
                ) : count === 0 ? (
                  <p className="mt-3 text-[0.9375rem] text-silverdim">
                    <Editable k="raffle.entrants.empty">Nobody yet. Be the first name on the list.</Editable>
                  </p>
                ) : (
                  <ul className="raffle-entrants mt-3 flex max-h-32 flex-wrap content-start gap-1.5 overflow-y-auto">
                    {data.entrants.map((e, i) => {
                      const me = myHandle !== null && e.handle.toLowerCase() === myHandle;
                      return (
                        <li
                          key={`${e.handle}-${i}`}
                          className={`border px-2 py-1 font-mono text-[0.75rem] ${
                            me ? "border-[rgba(246,226,122,0.6)] text-chalk" : "border-line text-silverdim"
                          }`}
                        >
                          {e.handle === "member" ? "member" : `@${e.handle}`}
                          {me && <span className="text-[#f6e27a]"> · you</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* --------------------------------------------------- cta -- */}
              <div className="border-t border-line px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-7 sm:pb-7">
                {cta}
                {problem && (
                  <p role="alert" className="label mt-3 leading-loose text-bloodhi">
                    {problem}
                  </p>
                )}
                <p className="mt-4 text-[0.75rem] leading-relaxed text-silverfaint">
                  <Editable k="raffle.rules">
                    {`Free to enter, no purchase necessary. Open to members with a verified ID. One entry per person, and your Instagram handle shows on the list when you enter. Winners are drawn at random and announced on ${org.instagramHandle}.`}
                  </Editable>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
