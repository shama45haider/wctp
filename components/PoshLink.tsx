"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Editable } from "./Editable";
import { asset } from "@/lib/asset";
import { btnBase } from "@/lib/ui";

/**
 * A GET TICKETS link for a date whose RSVP is on Posh (see poshRsvpFor() in
 * lib/tickets.ts), with a stop on the way out for the sponsor.
 *
 * A plain tap opens a full-screen "taking you to Posh" takeover: the East
 * Village Buyers shop front fills the screen behind a dark fade, an orange
 * ring counts down seven seconds, and then it goes. The link stays a real
 * link underneath: a Ctrl/Cmd-click or middle-click opens Posh in a new tab
 * the normal way, and nothing about it depends on the takeover ever showing.
 *
 * Tapping anywhere on it pauses the countdown - someone reading it, opening
 * directions or editing its text should not be whisked off mid-way - and
 * closing it keeps them on the page. The accents are the orange off the
 * shop's sign (--sponsor in globals.css) rather than the site's red.
 */

const SECONDS = 7;
const DIRECTIONS =
  "https://www.google.com/maps/search/?api=1&query=East+Village+Buyers%2C+39+Avenue+A%2C+New+York%2C+NY";

/** btnGo's shape, filled with the sponsor's orange so it holds up over the photo. */
const GO = `${btnBase} w-full border border-sponsor bg-sponsor text-void hover:brightness-110`;

function SponsorRedirect({ href, onClose }: { href: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const remaining = useRef(SECONDS * 1000);
  const [left, setLeft] = useState(SECONDS);
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const go = useCallback(() => {
    setLeaving(true);
    window.location.assign(href);
  }, [href]);

  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const budget = remaining.current;
    const tick = setInterval(() => {
      const ms = Math.max(0, budget - (Date.now() - start));
      remaining.current = ms;
      setLeft(Math.ceil(ms / 1000));
      if (ms === 0) {
        clearInterval(tick);
        go();
      }
    }, 100);
    return () => clearInterval(tick);
  }, [paused, go]);

  useEffect(() => {
    dialog.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Back from Posh can bring this page out of the back/forward cache with the
    // takeover still up and its countdown spent. Close it rather than leave it stuck.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pageshow", onShow);
    return () => {
      root.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pageshow", onShow);
    };
  }, [onClose]);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sponsor-title"
      aria-describedby="sponsor-body"
      tabIndex={-1}
      onPointerDown={() => setPaused(true)}
      onKeyDown={(e) => {
        if (e.key === "Tab") setPaused(true);
      }}
      className="sponsor-takeover fixed inset-0 z-[9100] overflow-y-auto overscroll-contain bg-void"
    >
      {/* The shop front is the whole backdrop: dimmed, faded to black where
          the text sits, and drifting slightly closer while the countdown runs. */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset("/sponsors/east-village-buyers-storefront.jpg")}
          alt=""
          width={1600}
          height={900}
          className="sponsor-drift h-full w-full object-cover object-[50%_40%] opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-void/70 via-void/35 to-void" />
      </div>

      <div className="sponsor-rise relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-4">
          <p className="label flex items-center gap-2 text-sponsor">
            <span className="h-1.5 w-1.5 rounded-full bg-sponsor" aria-hidden="true" />
            <Editable k="sponsor.evb.eyebrow">Our sponsor</Editable>
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stay on this page"
            className="-mr-1 flex h-11 w-11 items-center justify-center rounded-full border border-linehi bg-void/60 text-chalk backdrop-blur transition-colors hover:border-sponsor hover:text-sponsor"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* The countdown: an orange ring that runs down around the seconds left. */}
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="relative h-32 w-32">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="50" cy="50" r="45" fill="none" strokeWidth="3" className="stroke-linehi" />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                pathLength={100}
                className="sponsor-ring stroke-sponsor"
                style={{
                  animationDuration: `${SECONDS}s`,
                  animationPlayState: paused ? "paused" : "running",
                }}
              />
            </svg>
            <span className="font-display absolute inset-0 flex items-center justify-center text-[3.5rem] leading-none text-chalk">
              {left}
            </span>
          </div>
          <p className="label mt-4 text-silver">
            {leaving ? (
              "Opening Posh…"
            ) : paused ? (
              <Editable k="sponsor.evb.paused">No rush. Head to Posh when you&apos;re ready.</Editable>
            ) : (
              <Editable k="sponsor.evb.redirecting">Taking you to Posh</Editable>
            )}
          </p>
        </div>

        <div>
          <h2
            id="sponsor-title"
            className="font-display text-[clamp(2.25rem,10vw,3.5rem)] leading-[0.9] text-chalk uppercase"
          >
            <Editable k="sponsor.evb.title">Need a fit for the party?</Editable>
          </h2>
          <p id="sponsor-body" className="mt-3 max-w-[34ch] leading-relaxed text-silver">
            <Editable k="sponsor.evb.body">
              Check out East Village Buyers on 39 Avenue A. They&apos;ve got sneakers,
              streetwear and a whole lot more.
            </Editable>
          </p>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-linehi pt-4">
            <div className="min-w-0">
              <p className="label text-silverdim">
                <Editable k="sponsor.evb.address">East Village Buyers · 39 Avenue A</Editable>
              </p>
              <a
                href={DIRECTIONS}
                target="_blank"
                rel="noopener"
                className="label mt-1 inline-block py-2 text-sponsor underline decoration-sponsor/50 underline-offset-4 transition-colors hover:text-chalk"
              >
                GET DIRECTIONS &rarr;
              </a>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset("/sponsors/east-village-buyers-racks.jpg")}
              alt="Racks of hoodies and jackets inside East Village Buyers"
              width={640}
              height={360}
              className="aspect-[4/3] w-28 shrink-0 rotate-[4deg] border-2 border-sponsor object-cover shadow-[0_14px_30px_-12px_rgba(0,0,0,0.9)]"
            />
          </div>

          <button type="button" onClick={go} disabled={leaving} className={`${GO} mt-5`}>
            Take me to Posh
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PoshLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Stable, so a parent re-rendering (the live event list does, often) does
  // not re-run the takeover's focus and scroll-lock effect.
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <a
        href={href}
        className={className}
        onClick={(e) => {
          // New-tab clicks keep the browser's own behaviour.
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open && createPortal(<SponsorRedirect href={href} onClose={close} />, document.body)}
    </>
  );
}
