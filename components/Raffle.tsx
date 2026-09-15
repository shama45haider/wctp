"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Editable } from "./Editable";
import { org } from "@/lib/events";
import { avatarUrl, useOwnProfile } from "@/lib/profile-data";
import { bubble, round } from "@/lib/raffle-fonts";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { enterRaffle, loadRaffle, type Entrant, type RaffleState } from "@/lib/raffle";

/**
 * The members' raffle: a box that opens on the first visit, and a floating
 * bubble bottom-right once it has been closed. The raffle itself - title,
 * prizes, whether it's on the site or taking entries - is set in the admin
 * dashboard; entry rules live in the database (0015/0016). The button here
 * only explains which rule a guest hasn't met yet and sends them to fix it.
 *
 * Styled on purpose like a party-flyer sticker rather than the rest of the
 * site's chrome: flat candy colors, hard shadows and its own two fonts (see
 * lib/raffle-fonts.ts and the raffle-box block in globals.css).
 *
 * Renders nothing until the raffle has loaded - whether the box has been
 * seen is in localStorage, which the static export can't know - and nothing
 * on the pages someone is sent to in order to become eligible, so it never
 * sits on top of the sign-up or ID upload it just asked for.
 */

const HIDDEN_ON = ["/admin", "/pass", "/signup", "/login", "/reset-password", "/verify", "/checkout", "/raffle"];
const TILES = ["bg-[#ffe45c]", "bg-[#ff8cc6]", "bg-[#8fdcff]"];
const FONTS = `${bubble.variable} ${round.variable}`;
const seenKey = (raffleId: string) => `wctp.raffle.${raffleId}.seen`;

const CTA =
  "raffle-go raffle-bubbly flex min-h-12 w-full items-center justify-center gap-2 px-5 text-[1.125rem] uppercase disabled:cursor-not-allowed disabled:opacity-60";

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
    <div className={`rounded-2xl px-4 py-3 ${win ? "bg-[#ffe45c] text-void" : "bg-[#1a1c21] text-chalk"}`}>
      <p className="raffle-bubbly text-[1.25rem] leading-none uppercase">{title}</p>
      <p className={`mt-1.5 text-[0.8125rem] leading-snug ${win ? "text-[#3a3000]" : "text-silverdim"}`}>
        {body}
      </p>
    </div>
  );
}

/** An entrant's profile picture, or their first letter on a candy tile when they haven't set one. */
function Face({ entrant, index, className }: { entrant: Entrant; index: number; className: string }) {
  const url = avatarUrl(entrant.avatarPath);
  // Keyed by url so a reused row doesn't keep the last person's loaded/broken state.
  const [load, setLoad] = useState<{ url: string; ok: boolean } | null>(null);
  const status = url && load?.url === url ? (load.ok ? "loaded" : "broken") : "loading";
  return (
    <span
      aria-hidden="true"
      className={`${className} raffle-bubbly relative flex shrink-0 items-center justify-center overflow-hidden rounded-full text-[0.875rem] leading-none text-void ${TILES[index % TILES.length]}`}
    >
      {entrant.handle === "member" ? "?" : entrant.handle.charAt(0).toUpperCase()}
      {url && status !== "broken" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          onLoad={() => setLoad({ url, ok: true })}
          onError={() => setLoad({ url, ok: false })}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            status === "loaded" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </span>
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
  const [listOpen, setListOpen] = useState(false);
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
      <div className="flex flex-col items-center">
        <Link href="/signup" onClick={close} className={CTA}>
          <TicketIcon className="h-5 w-5" />
          Verify your ID to enter
        </Link>
        <Link
          href="/login"
          onClick={close}
          className="mt-1 flex min-h-11 items-center text-[0.8125rem] text-silverdim underline decoration-[#ff5fa8] decoration-2 underline-offset-4 transition-colors hover:text-chalk"
        >
          Already verified? Sign in
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
          className={`${FONTS} raffle-pill raffle-round fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[8990] flex min-h-12 items-center gap-2 py-1.5 pr-3.5 pl-1.5 lg:right-6 lg:bottom-6`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-void text-[#ffe45c]">
            <TicketIcon className="h-[1.125rem] w-[1.125rem]" />
          </span>
          <span className="raffle-bubbly text-[1.125rem] leading-none uppercase">
            {data.entered ? "You're in" : "Raffle"}
          </span>
          {!data.error && (
            <span className="rounded-full bg-void px-2 py-0.5 text-[0.75rem] font-semibold leading-tight text-[#ffe45c]">
              {count}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          className={`${FONTS} raffle-backdrop raffle-round fixed inset-0 z-[9000] flex items-end justify-center bg-void/75 backdrop-blur-sm sm:items-center sm:p-6`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="raffle-title"
            tabIndex={-1}
            className="raffle-sticker relative max-h-[90dvh] w-full overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none sm:max-w-[25rem] sm:px-5 sm:pt-5 sm:pb-5"
          >
            {/* --------------------------------------------------- top -- */}
            <div className="flex items-start justify-between gap-3">
              <span className="rounded-full bg-[#ff5fa8] px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide text-void uppercase">
                <Editable k="raffle.eyebrow">Members only · Free entry</Editable>
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Close the raffle"
                className="-mt-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ffe45c] text-void transition-transform active:scale-90">
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </span>
              </button>
            </div>

            <h2
              id="raffle-title"
              className="raffle-bubbly raffle-title mt-2 text-[clamp(2rem,9vw,2.5rem)] leading-[0.95] break-words"
            >
              {raffle.title}
            </h2>

            {raffle.blurb && (
              <p className="mt-1.5 line-clamp-3 text-[0.875rem] leading-snug text-silverdim">
                {raffle.blurb}
              </p>
            )}

            {/* ------------------------------------------------ prizes -- */}
            {prizes.length > 0 && (
              <ol className="mt-4 grid grid-cols-3 gap-2">
                {prizes.map((p, i) => (
                  <li
                    key={i}
                    className={`flex min-w-0 flex-col rounded-2xl p-2.5 text-void ${TILES[i] ?? "bg-[#c9f27a]"}`}
                  >
                    <span className="raffle-bubbly text-[1.75rem] leading-none">{i + 1}</span>
                    {p.place && (
                      <span className="mt-0.5 text-[0.625rem] font-semibold tracking-wide uppercase opacity-70">
                        {p.place}
                      </span>
                    )}
                    {p.items.length > 0 && (
                      <ul className="raffle-glare mt-1.5 flex flex-col gap-0.5 text-[0.75rem] leading-tight font-bold break-words">
                        {p.items.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {/* ---------------------------------------------- entrants -- */}
            <div className="mt-4">
              <div className="flex min-h-11 items-center gap-2">
                <span className="text-[0.75rem] font-semibold tracking-wide text-silver uppercase">
                  <Editable k="raffle.entrants.title">Who&rsquo;s in</Editable>
                </span>
                <span className="raffle-bubbly rounded-full bg-[#1a1c21] px-2 py-1 text-[0.8125rem] leading-none text-[#ffe45c]">
                  {data.error ? "–" : count}
                </span>
                {!data.error && count > 0 && (
                  <button
                    type="button"
                    onClick={() => setListOpen((v) => !v)}
                    aria-expanded={listOpen}
                    aria-controls="raffle-entrants"
                    className="ml-auto flex min-h-11 items-center gap-2 rounded-full bg-[#1a1c21] py-1 pr-3 pl-1.5 text-[0.8125rem] font-semibold text-chalk transition-colors hover:bg-[#23262d]"
                  >
                    <span className="flex -space-x-2" aria-hidden="true">
                      {data.entrants.slice(0, 3).map((e, i) => (
                        <Face
                          key={`${e.handle}-${i}`}
                          entrant={e}
                          index={i}
                          className="h-7 w-7 ring-2 ring-[#1a1c21]"
                        />
                      ))}
                    </span>
                    {listOpen ? "Hide" : "See all"}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className={`h-4 w-4 transition-transform ${listOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                )}
              </div>

              {data.error ? (
                <p className="mt-2 text-[0.75rem] leading-snug text-bloodhi">{data.error}</p>
              ) : count === 0 ? (
                <p className="mt-2 text-[0.8125rem] text-silverdim">
                  <Editable k="raffle.entrants.empty">Nobody yet. Be the first name on the list.</Editable>
                </p>
              ) : (
                listOpen && (
                  <ul
                    id="raffle-entrants"
                    className="raffle-list mt-2 flex max-h-60 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-2xl bg-[#1a1c21] p-1.5"
                  >
                    {data.entrants.map((e, i) => {
                      const me = myHandle !== null && e.handle.toLowerCase() === myHandle;
                      return (
                        <li
                          key={`${e.handle}-${i}`}
                          className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2 py-1.5 ${
                            me ? "bg-[#ffe45c] text-void" : "text-silver"
                          }`}
                        >
                          <Face entrant={e} index={i} className="h-8 w-8" />
                          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold">
                            {e.handle === "member" ? "member" : `@${e.handle}`}
                          </span>
                          {me && (
                            <span className="rounded-full bg-void px-2 py-0.5 text-[0.6875rem] font-semibold text-[#ffe45c]">
                              you
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </div>

            {/* --------------------------------------------------- cta -- */}
            <div className="mt-4">
              {cta}
              {problem && (
                <p role="alert" className="mt-2 text-[0.75rem] leading-snug text-bloodhi">
                  {problem}
                </p>
              )}
              <p className="mt-3 text-[0.6875rem] leading-snug text-silverfaint">
                <Editable k="raffle.rules">
                  {`Free, no purchase needed. Verified members only, one entry each - your @ shows on the list. Winners announced on ${org.instagramHandle}.`}
                </Editable>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
