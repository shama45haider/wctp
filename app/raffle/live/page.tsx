"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import RaffleWheel, { landingRotation, type WheelEntrant } from "@/components/RaffleWheel";
import { org } from "@/lib/events";
import { avatarUrl } from "@/lib/profile-data";
import {
  clearDraw,
  drawWinner,
  loadLive,
  type LiveDraw,
  type LiveEntrant,
  type LiveView,
} from "@/lib/raffle";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { btn, btnGo } from "@/lib/ui";

/**
 * The live raffle draw, for anyone holding the link.
 *
 * The token rides in ?t= and is checked by raffle_live() on every poll, so
 * the page stops working the moment the hour is up. Winners are picked in the
 * database; this page only animates what's already been decided. Each viewer
 * polls, and a draw it hasn't shown yet spins the wheel to the stored winner
 * at the stored spot in their slice - so every screen lands on the same
 * person, a few seconds apart at most. A signed-in admin gets a spin button
 * per place on this same page.
 *
 * The wheel for a draw is everyone who entered minus the people who won
 * before it, in entry order - the same list for every viewer, whenever they
 * opened the link.
 */

type Live = Extract<LiveView, { status: "live" }>;
type Phase = "idle" | "spinning" | "revealed";

const POLL_MS = 2500;
const SPIN_MS = 9000;
const MIN_SPIN_MS = 2500;
/** How long a revealed winner stays up before a queued spin starts. */
const HOLD_MS = 3500;
const TONES = ["gold", "silver", "bronze"];

const drawId = (d: LiveDraw) => `${d.place}:${d.drawnAt}`;
const at = (handle: string) => (handle === "member" ? "member" : `@${handle}`);

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}
const readToken = () => new URLSearchParams(window.location.search).get("t") ?? "";
const noToken = () => null;

/** Who was on the wheel for `draw`: everyone minus earlier winners. Null draw = minus every winner. */
function wheelFor(view: Live, draw: LiveDraw | null): LiveEntrant[] {
  const cutoff = draw ? Date.parse(draw.drawnAt) : Infinity;
  const gone = new Set(
    view.draws.filter((d) => Date.parse(d.drawnAt) < cutoff).map((d) => d.key),
  );
  return view.entrants.filter((e) => !gone.has(e.key));
}

function Avatar({ entrant, className }: { entrant: LiveEntrant | undefined; className: string }) {
  const url = avatarUrl(entrant?.avatarPath ?? null);
  // Keyed by url: this spot shows a different winner after every spin.
  const [load, setLoad] = useState<{ url: string; ok: boolean } | null>(null);
  const status = url && load?.url === url ? (load.ok ? "loaded" : "broken") : "loading";
  return (
    <span
      className={`${className} font-display relative flex items-center justify-center overflow-hidden rounded-full border border-linehi bg-ink2 text-silver`}
    >
      {(entrant?.handle[0] ?? "?").toUpperCase()}
      {url && status !== "broken" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
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

function Countdown({
  expiresAt,
  skewMs,
  onEnd,
}: {
  expiresAt: string;
  skewMs: number;
  onEnd: () => void;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const ended = useRef(false);

  useEffect(() => {
    const update = () => {
      const ms = Date.parse(expiresAt) - (Date.now() + skewMs);
      setLeft(Math.max(0, ms));
      if (ms <= 0 && !ended.current) {
        ended.current = true;
        onEnd();
      }
    };
    const first = setTimeout(update, 0);
    const every = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [expiresAt, skewMs, onEnd]);

  if (left === null) return <>--:--</>;
  const s = Math.ceil(left / 1000);
  return (
    <>
      {String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}
    </>
  );
}

function Ended({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-[70dvh] w-[92vw] max-w-[520px] flex-col items-center justify-center py-16 text-center">
      <p className="label text-silverfaint">WCTP RAFFLE</p>
      <h1 className="font-display chrome mt-4 text-[clamp(2.5rem,11vw,4rem)] leading-[0.85]">{title}</h1>
      <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">{body}</p>
      <a href={org.instagram} target="_blank" rel="noopener" className={`${btnGo} mt-8 w-full`}>
        Follow {org.instagramHandle}
      </a>
      <Link href="/" className={`${btn} mt-3 w-full`}>
        Back to the site
      </Link>
    </main>
  );
}

export default function RaffleLive() {
  const token = useSyncExternalStore(subscribeLocation, readToken, noToken);
  const { ready, isAdmin } = useSupabaseAuth();

  const [view, setView] = useState<LiveView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [skewMs, setSkewMs] = useState(0);

  const [wheelDraw, setWheelDraw] = useState<LiveDraw | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [rotation, setRotation] = useState(0);
  const [spinMs, setSpinMs] = useState(0);
  const [revealed, setRevealed] = useState<string[]>([]);

  const [busyPlace, setBusyPlace] = useState<number | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  const skew = useRef(0);
  const seen = useRef(new Set<string>());
  const firstLoad = useRef(true);
  const rotationNow = useRef(0);
  const spinning = useRef(false);
  const latest = useRef<Live | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const refetch = useCallback(() => setRefresh((n) => n + 1), []);

  // Spin timers outlive a re-poll (an admin's spin restarts polling mid-spin),
  // so they're only cleared when the page goes away.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  useEffect(() => {
    if (!token) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const later = (fn: () => void, ms: number) => {
      timers.current.push(setTimeout(fn, ms));
    };

    const turnTo = (deg: number, ms: number) => {
      rotationNow.current = deg;
      setSpinMs(ms);
      setRotation(deg);
    };

    const markSeen = (d: LiveDraw) => {
      const id = drawId(d);
      seen.current.add(id);
      setRevealed((r) => (r.includes(id) ? r : [...r, id]));
    };

    const spinNext = () => {
      const v = latest.current;
      if (!v || spinning.current) return;
      const next = v.draws.find((d) => !seen.current.has(drawId(d)));
      if (!next) return;

      const wheel = wheelFor(v, next);
      const index = wheel.findIndex((e) => e.key === next.key);
      if (index < 0) {
        // The winner's entry was removed after the draw - nothing to land on.
        markSeen(next);
        spinNext();
        return;
      }

      spinning.current = true;
      // Someone who opened the link mid-spin catches the tail end of it.
      const elapsed = Math.max(0, Date.now() + skew.current - Date.parse(next.drawnAt));
      const ms = Math.min(SPIN_MS, Math.max(MIN_SPIN_MS, SPIN_MS - elapsed));

      setWheelDraw(next);
      setPhase("spinning");
      // Shed whole turns without moving, so the next transition starts clean.
      turnTo(rotationNow.current % 360, 0);

      later(() => {
        turnTo(landingRotation(rotationNow.current, index, wheel.length, next.spinOffset), ms);
        later(() => {
          markSeen(next);
          setPhase("revealed");
          spinning.current = false;
          later(spinNext, HOLD_MS);
        }, ms + 200);
      }, 80);
    };

    const absorb = (v: Live) => {
      latest.current = v;
      const ids = new Set(v.draws.map(drawId));

      if (firstLoad.current) {
        firstLoad.current = false;
        // Everything already drawn is history, except a draw so recent that
        // everyone else is still watching it spin.
        const last = v.draws[v.draws.length - 1];
        const midSpin =
          last !== undefined && Date.now() + skew.current - Date.parse(last.drawnAt) < SPIN_MS;
        const history = midSpin ? v.draws.slice(0, -1) : v.draws;
        history.forEach((d) => seen.current.add(drawId(d)));
        setRevealed(history.map(drawId));

        const shown = history[history.length - 1];
        if (shown) {
          const wheel = wheelFor(v, shown);
          const index = wheel.findIndex((e) => e.key === shown.key);
          if (index >= 0) turnTo(landingRotation(0, index, wheel.length, shown.spinOffset, 0), 0);
          setWheelDraw(shown);
          setPhase("revealed");
        }
      } else {
        // A place the admin cleared: forget it, so its redraw spins again.
        let cleared = false;
        for (const id of seen.current) {
          if (!ids.has(id)) {
            seen.current.delete(id);
            cleared = true;
          }
        }
        if (cleared) {
          setRevealed((r) => r.filter((id) => ids.has(id)));
          setWheelDraw((w) => (w && !ids.has(drawId(w)) ? null : w));
        }
      }

      spinNext();
    };

    const poll = async () => {
      const res = await loadLive(token);
      if (!live) return;
      if (res.view) {
        setProblem(null);
        setView(res.view);
        // Expired or never valid: nothing more will ever come back.
        if (res.view.status !== "live") return;
        skew.current = Date.parse(res.view.serverNow) - Date.now();
        setSkewMs(skew.current);
        absorb(res.view);
      } else {
        setProblem(res.error ?? "Lost the connection. Retrying…");
      }
      timer = setTimeout(() => void poll(), document.hidden ? POLL_MS * 4 : POLL_MS);
    };

    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [token, refresh]);

  // The wheel only redraws when who's on it actually changes, not on every poll.
  const liveView = view?.status === "live" ? view : null;
  const shownPhase: Phase = phase === "revealed" && !wheelDraw ? "idle" : phase;
  const onWheel = liveView ? wheelFor(liveView, shownPhase === "idle" ? null : wheelDraw) : [];
  const signature = onWheel.map((e) => `${e.key}:${e.avatarPath ?? ""}:${e.handle}`).join("|");
  const [wheel, setWheel] = useState<{ signature: string; entrants: WheelEntrant[] }>({
    signature: "",
    entrants: [],
  });
  if (wheel.signature !== signature) {
    setWheel({
      signature,
      entrants: onWheel.map((e) => ({ key: e.key, handle: e.handle, avatarUrl: avatarUrl(e.avatarPath) })),
    });
  }

  if (token === null || (token && !view && !problem)) {
    return (
      <main className="mx-auto flex min-h-[70dvh] w-[92vw] items-center justify-center">
        <p className="label flex animate-pulse items-center gap-2 text-silverfaint">
          <span className="dot" /> CONNECTING TO THE LIVE DRAW…
        </p>
      </main>
    );
  }
  if (!token) {
    return <Ended title="This link isn't complete" body="Open the full link you were sent - it ends in a long code." />;
  }
  if (!view) {
    return (
      <main className="mx-auto flex min-h-[70dvh] w-[92vw] max-w-[520px] flex-col items-center justify-center text-center">
        <p className="label animate-pulse text-silverfaint">RECONNECTING…</p>
        <p className="label mt-3 leading-loose text-bloodhi">{problem?.toUpperCase()}</p>
      </main>
    );
  }
  if (view.status !== "live") {
    return view.status === "expired" ? (
      <Ended
        title="This live draw has ended"
        body={`Live links only last an hour. Winners are announced on ${org.instagramHandle}.`}
      />
    ) : (
      <Ended title="This link doesn't work" body="It may have been mistyped, or replaced by a newer live link." />
    );
  }

  const raffleId = view.raffle.id;
  const byKey = new Map(view.entrants.map((e) => [e.key, e]));
  const drawByPlace = new Map(view.draws.map((d) => [d.place, d]));
  const titleWords = view.raffle.title.trim().split(/\s+/);
  const titleLead = titleWords.length > 1 ? titleWords.slice(0, -1).join(" ") : "";
  const titleLast = titleWords[titleWords.length - 1] ?? "";

  const current = shownPhase === "idle" ? null : wheelDraw;
  const currentPrize = current ? view.raffle.prizes[current.place - 1] : undefined;
  const currentWinner = current ? byKey.get(current.key) : undefined;
  const placeName = (i: number) => view.raffle.prizes[i]?.place || `PLACE ${i + 1}`;
  const canControl = ready && isAdmin;

  const spin = async (place: number) => {
    setBusyPlace(place);
    setAdminError(null);
    const out = await drawWinner(raffleId, place);
    setBusyPlace(null);
    if (!out.ok) {
      setAdminError(out.error ?? "The wheel didn't spin.");
      return;
    }
    refetch();
  };

  const clear = async (place: number) => {
    if (!window.confirm(`Clear the winner for ${placeName(place - 1)}? That place can be spun again.`)) return;
    setBusyPlace(place);
    setAdminError(null);
    const out = await clearDraw(raffleId, place);
    setBusyPlace(null);
    if (!out.ok) {
      setAdminError(out.error ?? "Couldn't clear it.");
      return;
    }
    refetch();
  };

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(1.25rem,4vw,3rem)]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="dot shrink-0" />
            <span className="label text-bloodhi">LIVE DRAW</span>
          </p>
          <h1 className="font-display mt-3 text-[clamp(2.5rem,9vw,5rem)] leading-[0.82] tracking-[-0.02em] break-words">
            {titleLead && <span className="chrome">{titleLead} </span>}
            <span className="raffle-gold">{titleLast}</span>
          </h1>
        </div>
        <div className="flex gap-6 sm:text-right">
          <div>
            <p className="label text-silverfaint">ON THE WHEEL</p>
            <p className="font-display mt-1 text-[2rem] leading-none text-chalk">{wheel.entrants.length}</p>
          </div>
          <div>
            <p className="label text-silverfaint">LINK ENDS IN</p>
            <p className="font-display mt-1 text-[2rem] leading-none text-chalk tabular-nums">
              <Countdown expiresAt={view.expiresAt} skewMs={skewMs} onEnd={refetch} />
            </p>
          </div>
        </div>
      </header>

      {problem && (
        <p className="label mt-4 leading-loose text-bloodhi" role="status">
          {problem.toUpperCase()}
        </p>
      )}

      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-live="polite">
          <RaffleWheel
            entrants={wheel.entrants}
            rotation={rotation}
            spinMs={spinMs}
            highlightKey={shownPhase === "revealed" ? current?.key : null}
          />

          <div className="mx-auto mt-8 max-w-md">
            {shownPhase === "spinning" && current && (
              <p className="font-display animate-pulse text-center text-[1.75rem] leading-none tracking-[0.08em] text-chalk uppercase">
                Spinning for {placeName(current.place - 1)}…
              </p>
            )}

            {shownPhase === "revealed" && current && revealed.includes(drawId(current)) && (
              <div className="raffle-ring">
                <div className="flex items-center gap-4 bg-ink p-4">
                  <Avatar entrant={currentWinner} className="h-16 w-16 shrink-0 text-[1.75rem]" />
                  <div className="min-w-0">
                    <p className="label text-silverfaint">{placeName(current.place - 1)} · WINNER</p>
                    <p className="font-display raffle-gold mt-1 text-[clamp(1.75rem,7vw,2.5rem)] leading-none break-all">
                      {currentWinner ? at(currentWinner.handle) : "Winner"}
                    </p>
                    {currentPrize && currentPrize.items.length > 0 && (
                      <p className="mt-2 text-[0.875rem] leading-snug text-silverdim">
                        {currentPrize.items.join(" + ")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {shownPhase === "idle" && (
              <p className="label text-center leading-loose text-silverfaint">
                {view.entrants.length === 0
                  ? "NOBODY ENTERED THIS RAFFLE"
                  : "WAITING FOR THE NEXT SPIN"}
              </p>
            )}
          </div>
        </section>

        <aside className="border border-line bg-ink">
          <p className="label border-b border-line px-4 py-3 text-silverfaint">PRIZES</p>
          <ol>
            {view.raffle.prizes.map((prize, i) => {
              const place = i + 1;
              const draw = drawByPlace.get(place);
              const shown = draw && revealed.includes(drawId(draw));
              const winner = draw ? byKey.get(draw.key) : undefined;
              return (
                <li key={place} className="border-b border-line px-4 py-4 last:border-b-0">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`raffle-${TONES[i] ?? "silver"} font-display w-9 shrink-0 text-center text-[2.5rem] leading-[0.85]`}
                    >
                      {place}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="label text-silverfaint">{placeName(i)}</p>
                      {prize.items.length > 0 && (
                        <p className="mt-1 text-[0.875rem] leading-snug text-silver">
                          {prize.items.join(" + ")}
                        </p>
                      )}

                      <div className="mt-3 flex min-h-11 items-center gap-2.5">
                        {shown ? (
                          <>
                            <Avatar entrant={winner} className="h-9 w-9 shrink-0 text-[1rem]" />
                            <span className="font-display raffle-gold min-w-0 truncate text-[1.25rem] leading-none">
                              {winner ? at(winner.handle) : "Winner"}
                            </span>
                          </>
                        ) : draw ? (
                          <span className="label animate-pulse text-silver">SPINNING…</span>
                        ) : (
                          <span className="label text-silverfaint">NOT DRAWN YET</span>
                        )}
                      </div>

                      {canControl && (
                        <div className="mt-2">
                          {draw ? (
                            <button
                              type="button"
                              onClick={() => void clear(place)}
                              disabled={busyPlace !== null || shownPhase === "spinning"}
                              className="label min-h-11 text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk disabled:opacity-50"
                            >
                              CLEAR &amp; SPIN AGAIN
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void spin(place)}
                              disabled={busyPlace !== null || shownPhase === "spinning" || wheel.entrants.length === 0}
                              className={`${btnGo} w-full`}
                            >
                              {busyPlace === place ? "Drawing…" : `Spin for ${placeName(i)}`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {canControl && (
            <div className="border-t border-line px-4 py-3">
              <p className="label leading-loose text-silverfaint">
                ONLY ADMINS SEE THE SPIN BUTTONS. EVERYONE WITH THE LINK WATCHES THE SAME SPIN.
              </p>
              {adminError && (
                <p className="label mt-2 leading-loose text-bloodhi" role="alert">
                  {adminError}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
