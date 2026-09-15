"use client";

import { useEffect, useState } from "react";
import { Editable } from "./Editable";
import { atHandle } from "@/lib/handle";
import { avatarUrl } from "@/lib/profile-data";
import { usd } from "@/lib/tickets";
import { btnGo } from "@/lib/ui";
import { DONOR_BOARD_CHANGED, loadDonorBoard, type Donor } from "@/lib/donate";

/**
 * The people who gave, ranked by how much, with their faces and a way to
 * follow them. Only donors who were signed in and left "put me on the board"
 * on are here - see donor_board() in 0017. Loads after mount; the static
 * export can't know who has given.
 */

const PODIUM = [
  { text: "raffle-gold", ring: "border-[#e9c46a]", glow: "shadow-[0_22px_60px_-28px_rgba(233,196,106,0.6)]" },
  { text: "raffle-silver", ring: "border-[#c9cdd4]", glow: "shadow-[0_22px_60px_-28px_rgba(201,205,212,0.45)]" },
  { text: "raffle-bronze", ring: "border-[#c98a55]", glow: "shadow-[0_22px_60px_-28px_rgba(201,138,85,0.5)]" },
];

const dollars = (cents: number) => usd(cents).replace(/\.00$/, "");
const igUrl = (handle: string) => `https://www.instagram.com/${encodeURIComponent(handle)}/`;
const title = (d: Donor) => (d.handle ? atHandle(d.handle) : d.displayName || "member");

function Face({ donor, className }: { donor: Donor; className: string }) {
  const url = avatarUrl(donor.avatarPath);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" className={`${className} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} font-display flex shrink-0 items-center justify-center rounded-full bg-ink2 text-silver`}
    >
      {(donor.handle ?? donor.displayName ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

function Given({ donor }: { donor: Donor }) {
  return (
    <p className="label mt-1.5 text-silverfaint">
      {dollars(donor.totalCents)} GIVEN
      {donor.gifts > 1 ? ` · ${donor.gifts} GIFTS` : ""}
    </p>
  );
}

export default function DonorBoard() {
  const [board, setBoard] = useState<{ donors: Donor[]; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(DONOR_BOARD_CHANGED, bump);
    return () => window.removeEventListener(DONOR_BOARD_CHANGED, bump);
  }, []);

  useEffect(() => {
    let live = true;
    void loadDonorBoard().then((next) => {
      if (live) setBoard(next);
    });
    return () => {
      live = false;
    };
  }, [tick]);

  return (
    <section aria-labelledby="donor-board-title" className="mt-16">
      <p className="label text-bloodhi">
        <Editable k="donate.board.eyebrow">HALL OF FAME</Editable>
      </p>
      <h2
        id="donor-board-title"
        className="font-display chrome mt-2 text-[clamp(2.25rem,8vw,3.25rem)] leading-[0.85]"
      >
        <Editable k="donate.board.title">Donor board</Editable>
      </h2>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        <Editable k="donate.board.blurb">
          The people keeping the nights running. Show them love - go follow them.
        </Editable>
      </p>

      {board === null ? (
        <p className="label mt-6 text-silverfaint">LOADING&hellip;</p>
      ) : board.error ? (
        <p className="label mt-6 text-bloodhi" role="alert">
          {board.error}
        </p>
      ) : board.donors.length === 0 ? (
        <div className="mt-6 border border-dashed border-linehi px-5 py-8 text-center">
          <p className="font-display text-[1.5rem]">
            <Editable k="donate.board.emptyTitle">This spot is yours</Editable>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-silverdim">
            <Editable k="donate.board.emptyBody">
              Nobody is on the board yet. Sign in, give, and your picture goes up first.
            </Editable>
          </p>
        </div>
      ) : (
        <ol className="mt-6 flex flex-col gap-3">
          {board.donors.map((d, i) => {
            const podium = PODIUM[i];
            if (podium) {
              return (
                <li
                  key={`${d.handle ?? "member"}-${i}`}
                  className={`border bg-ink p-4 sm:p-5 ${podium.ring} ${podium.glow}`}
                >
                  <div className="flex items-center gap-4">
                    <span
                      className={`font-display w-8 shrink-0 text-center text-[2.5rem] leading-none ${podium.text}`}
                    >
                      {i + 1}
                    </span>
                    <Face donor={d} className={`h-16 w-16 border-2 text-[1.5rem] ${podium.ring}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-display truncate text-[1.4rem] leading-tight">{title(d)}</p>
                      {d.handle && d.displayName && (
                        <p className="truncate text-sm text-silverdim">{d.displayName}</p>
                      )}
                      <Given donor={d} />
                    </div>
                  </div>
                  {d.handle && (
                    <a
                      href={igUrl(d.handle)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${btnGo} mt-4 w-full`}
                    >
                      Follow {atHandle(d.handle)}
                    </a>
                  )}
                </li>
              );
            }
            return (
              <li
                key={`${d.handle ?? "member"}-${i}`}
                className="flex items-center gap-3 border border-line bg-ink px-3 py-2.5"
              >
                <span className="label w-6 shrink-0 text-center text-silverfaint">{i + 1}</span>
                <Face donor={d} className="h-10 w-10 text-base" />
                <div className="min-w-0 flex-1">
                  <p className="font-display truncate text-[1.1rem] leading-tight">{title(d)}</p>
                  <Given donor={d} />
                </div>
                {d.handle && (
                  <a
                    href={igUrl(d.handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Follow ${atHandle(d.handle)} on Instagram`}
                    className="label flex min-h-11 shrink-0 items-center border border-line px-3 text-silverdim transition-colors hover:border-linehi hover:text-chalk"
                  >
                    FOLLOW
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
