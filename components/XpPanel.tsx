"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Editable } from "./Editable";
import { myXp, rankOf, WORTH, FRIEND_CAP, type XpBreakdown } from "@/lib/xp";

/**
 * Your standing, and its working.
 *
 * The breakdown is not decoration. XP is counted off rows in five different
 * tables and nobody is going to trust a bare number they cannot account for -
 * so every line says how many of the thing, what each was worth, and what that
 * came to.
 */

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; xp: XpBreakdown };

function Line({
  label,
  count,
  each,
  earned,
  note,
}: {
  label: string;
  count: number;
  each: number;
  earned: number;
  note?: string;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-linesoft py-3 last:border-b-0">
      <span className="min-w-0 flex-1 text-[0.9375rem] text-chalk">
        {label}
        {note && <span className="label ml-2 text-silverfaint">{note}</span>}
      </span>
      <span className="label text-silverfaint tabular-nums">
        {count} × {each}
      </span>
      <span className="label w-16 text-right text-silver tabular-nums">
        {earned}
      </span>
    </li>
  );
}

export default function XpPanel() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    const { xp, error } = await myXp();
    if (!alive.current) return;
    setLoad(
      error || !xp
        ? { kind: "error", message: error ?? "Nothing came back." }
        : { kind: "ready", xp },
    );
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  return (
    <section className="mt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <h2 className="font-display text-[2rem]">
          <Editable k="account.xp.title">Standing</Editable>
        </h2>
      </div>

      {load.kind === "loading" && (
        <p className="label animate-pulse text-silverfaint uppercase">Counting…</p>
      )}

      {load.kind === "error" && (
        <p
          className="border border-[rgba(200,16,46,0.45)] px-4 py-3 text-[0.875rem] leading-relaxed text-bloodhi"
          role="alert"
        >
          {load.message}
        </p>
      )}

      {load.kind === "ready" && (() => {
        const { xp } = load;
        const rank = rankOf(xp.total);
        return (
          <>
            <div className="border border-line bg-ink p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="label text-silverfaint uppercase">
                    <Editable k="account.xp.rank">Rank</Editable>
                  </p>
                  <p className="font-display mt-1.5 text-[clamp(1.75rem,6vw,2.5rem)] leading-none text-chalk">
                    {rank.name}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-[clamp(1.75rem,6vw,2.5rem)] leading-none text-chalk tabular-nums">
                    {xp.total}
                  </p>
                  <p className="label mt-1 text-silverfaint uppercase">XP</p>
                </div>
              </div>

              {/* The bar is the distance to the next rung, not to the top. */}
              <div className="mt-5 h-1.5 w-full bg-linesoft">
                <div
                  className="h-full bg-blood transition-[width] duration-500"
                  style={{ width: `${Math.round(rank.progress * 100)}%` }}
                />
              </div>
              <p className="mt-2.5 text-[0.8125rem] text-silverfaint">
                {rank.next
                  ? `${rank.toGo} to ${rank.next}.`
                  : "Top of the ladder."}
              </p>
            </div>

            <ul className="mt-6 border-t border-line">
              <Line
                label="Nights you were scanned in"
                count={xp.attended}
                each={WORTH.attended}
                earned={xp.attendedXp}
              />
              <Line
                label="Tickets bought"
                count={xp.tickets}
                each={WORTH.ticket}
                earned={xp.ticketsXp}
              />
              <Line
                label="Friends"
                count={xp.friends}
                each={WORTH.friend}
                earned={xp.friendsXp}
                note={xp.friends >= FRIEND_CAP ? "CAPPED" : `MAX ${FRIEND_CAP}`}
              />
              <Line
                label="Song requests"
                count={xp.requests}
                each={WORTH.request}
                earned={xp.requestsXp}
              />
              <Line
                label="Raffles entered"
                count={xp.raffles}
                each={WORTH.raffle}
                earned={xp.rafflesXp}
              />
            </ul>

            <p className="mt-4 text-[0.8125rem] leading-relaxed text-silverfaint">
              <Editable k="account.xp.note">
                Counted fresh every time you look. Cancel an order and it stops
                counting.
              </Editable>
            </p>
          </>
        );
      })()}
    </section>
  );
}
