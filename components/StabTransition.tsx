"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A short cartoon transition for a flyer click: a knife drops onto the poster,
 * blood splats out from the point of impact, and only then does the page
 * change. The animation lives in globals.css (.stab-*). With reduced motion
 * the page changes straight away.
 *
 * Anything that wants the effect calls stabTo() with the click position; this
 * component is mounted once in the root layout and listens for that event.
 */

const EVENT = "wctp:stab";
/** Long enough for the knife (0.55s) and the splats to land (to ~0.95s). */
const LEAVE_AFTER_MS = 1100;

type Stab = { href: string; x: number; y: number };

export function stabTo(href: string, x: number, y: number) {
  window.dispatchEvent(new CustomEvent<Stab>(EVENT, { detail: { href, x, y } }));
}

/** Where the splats land around the impact point: offsets in px, size, delay. */
const SPLATS = [
  { dx: 0, dy: 0, size: 120, delay: 0.55 },
  { dx: -70, dy: -40, size: 70, delay: 0.6 },
  { dx: 60, dy: -55, size: 80, delay: 0.63 },
  { dx: -40, dy: 60, size: 66, delay: 0.67 },
  { dx: 75, dy: 40, size: 90, delay: 0.7 },
  { dx: -95, dy: 15, size: 54, delay: 0.74 },
];

function Blood() {
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden="true" className="h-full w-full">
      <path
        d="M0,-28 C10,-30 12,-12 26,-14 C34,-16 38,-6 30,0 C40,6 34,20 24,16 C20,30 6,34 0,26 C-8,36 -22,30 -18,18 C-32,18 -36,6 -26,0 C-36,-8 -24,-20 -14,-14 C-12,-26 -6,-27 0,-28Z"
        fill="#8c0d17"
      />
    </svg>
  );
}

function Knife() {
  // Point at the bottom centre, so the tip is what lands on the flyer.
  return (
    <svg viewBox="0 0 60 160" aria-hidden="true" width="60" height="160">
      <path d="M30,160 L22,110 L20,30 L30,0 L40,30 L38,110 Z" fill="#d9dde3" />
      <path d="M30,160 L26,118 L30,112 L34,118 Z" fill="#fff" opacity="0.5" />
      <rect x="18" y="108" width="24" height="10" rx="2" fill="#2a2a2a" />
      <rect x="22" y="118" width="16" height="36" rx="5" fill="#111" />
    </svg>
  );
}

export default function StabTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const [stab, setStab] = useState<Stab | null>(null);

  useEffect(() => {
    let leave: number | undefined;
    const onStab = (e: Event) => {
      const d = (e as CustomEvent<Stab>).detail;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push(d.href);
        return;
      }
      setStab(d);
      leave = window.setTimeout(() => router.push(d.href), LEAVE_AFTER_MS);
    };
    window.addEventListener(EVENT, onStab);
    return () => {
      window.removeEventListener(EVENT, onStab);
      window.clearTimeout(leave);
    };
  }, [router]);

  // Once the new page is showing, the overlay has done its job.
  useEffect(() => {
    setStab(null);
  }, [pathname]);

  if (!stab) return null;

  const style = { "--sx": `${stab.x}px`, "--sy": `${stab.y}px` } as React.CSSProperties;

  return (
    <div aria-hidden="true" className="stab-overlay" style={style}>
      <div className="stab-knife">
        <Knife />
      </div>
      {SPLATS.map((s, i) => (
        <div
          key={i}
          className="stab-splat"
          style={
            {
              width: s.size,
              height: s.size,
              marginLeft: -s.size / 2 + s.dx,
              marginTop: -s.size / 2 + s.dy,
              animationDelay: `${s.delay}s`,
            } as React.CSSProperties
          }
        >
          <Blood />
        </div>
      ))}
    </div>
  );
}
