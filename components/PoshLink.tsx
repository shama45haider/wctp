"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Editable } from "./Editable";
import { asset } from "@/lib/asset";
import { btnGo } from "@/lib/ui";

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
 *
 * Drawn like the site's other dialogs (HelpLinks, Editable): a plain panel
 * with a hairline border, a sheet along the bottom on a phone.
 */

const SECONDS = 7;
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
      className="sponsor-backdrop fixed inset-0 z-[9100] flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center sm:p-6"
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
        className="sponsor-box max-h-[92dvh] w-full overflow-y-auto overscroll-contain border-t border-linehi bg-ink p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] outline-none sm:max-w-md sm:border sm:pb-5"
      >
        <div className="flex items-center justify-between gap-4">
          <p className="label text-silverfaint">
            <Editable k="sponsor.evb.eyebrow">Our sponsor</Editable>
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stay on this page"
            className="label -my-3 -mr-2 min-h-11 px-2 text-silverfaint transition-colors hover:text-chalk"
          >
            CLOSE
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset("/sponsors/east-village-buyers-storefront.jpg")}
            alt="The East Village Buyers shop front on Avenue A"
            width={960}
            height={540}
            className="aspect-[4/3] w-full border border-line object-cover"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset("/sponsors/east-village-buyers-racks.jpg")}
            alt="Racks of hoodies and jackets inside the shop"
            width={640}
            height={360}
            className="aspect-[4/3] w-full border border-line object-cover"
          />
        </div>

        <h2 id="sponsor-title" className="font-display mt-5 text-[1.75rem] leading-tight text-chalk">
          <Editable k="sponsor.evb.title">Need a fit for the party?</Editable>
        </h2>
        <p id="sponsor-body" className="mt-2 leading-relaxed text-silverdim">
          <Editable k="sponsor.evb.body">
            Check out East Village Buyers on 39 Avenue A. They&apos;ve got sneakers,
            streetwear and a whole lot more.
          </Editable>
        </p>
        <a
          href={DIRECTIONS}
          target="_blank"
          rel="noopener"
          className="label inline-block py-3 text-silver underline decoration-linehi underline-offset-4 transition-colors hover:text-chalk"
        >
          GET DIRECTIONS &rarr;
        </a>

        <div className="mt-2">
          <p className="label text-silverfaint">
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
          <div className="mt-2 h-0.5 bg-line">
            <div
              className="sponsor-bar h-full bg-bloodhi"
              style={{
                animationDuration: `${SECONDS}s`,
                animationPlayState: paused ? "paused" : "running",
              }}
            />
          </div>
        </div>

        <button type="button" onClick={go} disabled={leaving} className={`${btnGo} mt-5 w-full`}>
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
