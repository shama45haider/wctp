"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Editable } from "./Editable";
import { asset } from "@/lib/asset";
import { bubble, round } from "@/lib/raffle-fonts";

/**
 * A GET TICKETS link for a date whose RSVP is on Posh (see poshRsvpFor() in
 * lib/tickets.ts), with a stop on the way out for the sponsor.
 *
 * A plain tap opens a short "taking you to Posh" box that shows East Village
 * Buyers and counts down seven seconds before going. The link stays a real
 * link underneath: a Ctrl/Cmd-click or middle-click opens Posh in a new tab
 * the normal way, and nothing about it depends on the box ever showing.
 *
 * Tapping anything inside the box pauses the countdown - someone reading it,
 * opening directions or editing its text should not be whisked off mid-way -
 * and closing it keeps them on the page.
 */

const SECONDS = 7;
const FONTS = `${bubble.variable} ${round.variable}`;
const DIRECTIONS =
  "https://www.google.com/maps/search/?api=1&query=East+Village+Buyers%2C+39+Avenue+A%2C+New+York%2C+NY";

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
    // box still up and its countdown spent. Close it rather than leave it stuck.
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
      className={`${FONTS} raffle-round raffle-backdrop fixed inset-0 z-[9100] flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center sm:p-6`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
        className="sponsor-sticker relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none sm:max-w-[26rem] sm:px-5 sm:pt-5 sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="rounded-full bg-[#ff3b30] px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide text-void uppercase">
            <Editable k="sponsor.evb.eyebrow">Our sponsor</Editable>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stay on this page"
            className="-mt-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ffc21a] text-void transition-transform active:scale-90">
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

        {/* The storefront carries the name and the address; the racks, tilted
            over its corner, show what is inside. */}
        <div className="relative mt-3 mb-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset("/sponsors/east-village-buyers-storefront.jpg")}
            alt="The East Village Buyers shop front on Avenue A"
            width={960}
            height={540}
            className="aspect-[16/9] w-full rounded-2xl border-2 border-[#ffc21a] object-cover"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset("/sponsors/east-village-buyers-racks.jpg")}
            alt="Racks of hoodies and jackets inside the shop"
            width={640}
            height={360}
            className="absolute right-2 -bottom-6 aspect-[16/9] w-[44%] rotate-[4deg] rounded-xl border-2 border-void object-cover shadow-[4px_4px_0_#ff3b30]"
          />
        </div>

        <h2
          id="sponsor-title"
          className="raffle-bubbly sponsor-title text-[clamp(1.75rem,8vw,2.25rem)] leading-[0.95]"
        >
          <Editable k="sponsor.evb.title">Need a fit for the party?</Editable>
        </h2>
        <p id="sponsor-body" className="mt-2 text-[0.9375rem] leading-snug text-silver">
          <Editable k="sponsor.evb.body">
            Check out East Village Buyers on 39 Avenue A. They&apos;ve got sneakers,
            streetwear and a whole lot more.
          </Editable>
        </p>
        <a
          href={DIRECTIONS}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 items-center text-[0.875rem] font-semibold text-[#ffc21a] underline decoration-[#ff3b30] decoration-2 underline-offset-4 transition-colors hover:text-chalk"
        >
          Get directions &rarr;
        </a>

        <div className="mt-2 rounded-2xl bg-[#1a1c21] px-4 py-3">
          <p className="text-[0.8125rem] font-semibold text-chalk">
            {leaving ? (
              "Opening Posh…"
            ) : paused ? (
              <Editable k="sponsor.evb.paused">No rush. Head to Posh when you&apos;re ready.</Editable>
            ) : (
              <>
                <Editable k="sponsor.evb.countdown">Taking you to Posh in</Editable> {left}…
              </>
            )}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#2a2d34]">
            <div
              className="sponsor-bar h-full rounded-full bg-[#ffc21a]"
              style={{
                animationDuration: `${SECONDS}s`,
                animationPlayState: paused ? "paused" : "running",
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={go}
          disabled={leaving}
          className="sponsor-go raffle-bubbly mt-4 flex min-h-12 w-full items-center justify-center px-5 text-[1.125rem] uppercase disabled:opacity-60"
        >
          Take me to Posh
        </button>
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
  // not re-run the box's focus and scroll-lock effect.
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
