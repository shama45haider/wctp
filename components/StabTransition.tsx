"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A short transition for a flyer click. A knife is thrown across the screen,
 * sticks through the flyer, and blood splashes over the whole screen. Then the
 * page changes underneath and the blood wipes away to reveal it. The animation
 * lives in globals.css (.stab-*). With reduced motion the page changes at once.
 *
 * Anything that wants the effect calls stabTo() with the click position and the
 * flyer's box and artwork; this component is mounted once in the root layout.
 */

const EVENT = "wctp:stab";
/** The knife lands at 0.5s; the blood fills the screen by about 1.0s. */
const LEAVE_AFTER_MS = 1500;
/** The blood wipes away once the new page is showing. */
const WIPE_MS = 700;

/** The flyer that was clicked: where it sits on screen and its artwork. */
type Flyer = { left: number; top: number; width: number; height: number; src: string | null };
type Stab = { href: string; x: number; y: number; flyer: Flyer | null };

export function stabTo(href: string, x: number, y: number, flyer: Flyer | null = null) {
  window.dispatchEvent(new CustomEvent<Stab>(EVENT, { detail: { href, x, y, flyer } }));
}

/** Blood across the whole screen, centred on the strike. Sizes and offsets are
    in vmax so they cover a phone and a desktop alike. */
const SCREEN_SPLATS = [
  { size: 120, ox: 0, oy: 0, delay: 0.5 },
  { size: 70, ox: -26, oy: -18, delay: 0.56 },
  { size: 80, ox: 24, oy: -22, delay: 0.6 },
  { size: 90, ox: -22, oy: 24, delay: 0.64 },
  { size: 100, ox: 30, oy: 20, delay: 0.7 },
  { size: 60, ox: -46, oy: 6, delay: 0.74 },
  { size: 60, ox: 44, oy: 4, delay: 0.78 },
];

/* Each splat is a wet pool: a dark-to-bright radial body, an irregular edge,
   drips running down, and a glossy highlight. Gradients are defined once per
   splat so the shading stays inside the shape. */
function Blood({ id }: { id: string }) {
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden="true" className="h-full w-full overflow-visible">
      <defs>
        <radialGradient id={id} cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#e23a43" />
          <stop offset="45%" stopColor="#9c131d" />
          <stop offset="100%" stopColor="#4a060c" />
        </radialGradient>
      </defs>
      <path
        d="M0,-28 C10,-30 12,-12 26,-14 C34,-16 38,-6 30,0 C40,6 34,20 24,16 C20,30 6,34 0,26 C-8,36 -22,30 -18,18 C-32,18 -36,6 -26,0 C-36,-8 -24,-20 -14,-14 C-12,-26 -6,-27 0,-28Z"
        fill={`url(#${id})`}
      />
      {/* Drips sliding down from the rim. */}
      <path d="M-6,22 q-2,10 0,16 q2,-6 2,-16z" fill={`url(#${id})`} />
      <path d="M20,14 q-1.5,7 0,11 q1.5,-4 1.5,-11z" fill={`url(#${id})`} />
      {/* Gloss: a soft highlight so it reads as wet, not flat. */}
      <ellipse cx="-8" cy="-12" rx="7" ry="4" fill="#fff" opacity="0.28" transform="rotate(-25 -8 -12)" />
    </svg>
  );
}

/* A kitchen knife seen from the side: a shaded steel blade with a bright edge
   and a fuller, a bolstered black handle and rivets. The tip is at the bottom
   centre, so the tip is what lands on the flyer. */
function Knife() {
  return (
    <svg viewBox="0 0 60 160" aria-hidden="true" width="60" height="160">
      <defs>
        <linearGradient id="stab-steel" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#5d646e" />
          <stop offset="38%" stopColor="#f3f6f9" />
          <stop offset="62%" stopColor="#aab2bc" />
          <stop offset="100%" stopColor="#3d434b" />
        </linearGradient>
        <linearGradient id="stab-handle" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#050505" />
          <stop offset="40%" stopColor="#3a3a3a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>
      {/* Blade: a tapering shape with a sharpened point. */}
      <path d="M30,160 L22,112 L20,30 L30,0 L40,30 L38,112 Z" fill="url(#stab-steel)" />
      {/* Cutting edge catches the light down its length. */}
      <path d="M30,160 L38,112 L36,112 L28,150 Z" fill="#fff" opacity="0.8" />
      {/* Fuller: the groove down the spine of the blade. */}
      <path d="M30,20 L30,104" stroke="#6b7480" strokeWidth="1.2" opacity="0.7" />
      {/* Bolster and handle. */}
      <rect x="17" y="106" width="26" height="12" rx="3" fill="url(#stab-steel)" />
      <rect x="21" y="117" width="18" height="38" rx="6" fill="url(#stab-handle)" />
      <circle cx="30" cy="126" r="2" fill="#9aa2ac" />
      <circle cx="30" cy="140" r="2" fill="#9aa2ac" />
    </svg>
  );
}

/** Small droplets flung off the strike: they leave the point and arc outward. */
const SPRAY = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2 + 0.3;
  const reach = 14 + ((i * 37) % 22); // in vmax
  return {
    dx: Math.round(Math.cos(angle) * reach * 10) / 10,
    dy: Math.round(Math.sin(angle) * reach * 10) / 10,
    size: 6 + (i % 3) * 4,
    delay: 0.52 + (i % 4) * 0.02,
  };
});

export default function StabTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const [stab, setStab] = useState<Stab | null>(null);
  const [wiping, setWiping] = useState(false);
  // Whether a transition is on screen, and whether its wipe has started.
  const active = useRef(false);
  const wipeStarted = useRef(false);

  // Wipes the blood away to show the page underneath. Runs once per transition.
  const startWipe = () => {
    if (!active.current || wipeStarted.current) return;
    wipeStarted.current = true;
    setWiping(true);
    window.setTimeout(() => {
      active.current = false;
      wipeStarted.current = false;
      setWiping(false);
      setStab(null);
    }, WIPE_MS);
  };

  useEffect(() => {
    let leave: number | undefined;
    let fallback: number | undefined;
    const onStab = (e: Event) => {
      const d = (e as CustomEvent<Stab>).detail;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push(d.href);
        return;
      }
      active.current = true;
      setWiping(false);
      setStab(d);
      leave = window.setTimeout(() => {
        router.push(d.href);
        // Linking to the page already open changes no pathname, so the wipe
        // below would never start; start it anyway once the push has run.
        fallback = window.setTimeout(startWipe, 1200);
      }, LEAVE_AFTER_MS);
    };
    window.addEventListener(EVENT, onStab);
    return () => {
      window.removeEventListener(EVENT, onStab);
      window.clearTimeout(leave);
      window.clearTimeout(fallback);
    };
    // startWipe reads only refs and state setters, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // The new page has arrived under the blood: wipe the blood away to show it.
  useEffect(() => {
    startWipe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!stab) return null;

  const style = { "--sx": `${stab.x}px`, "--sy": `${stab.y}px` } as React.CSSProperties;
  const f = stab.flyer;

  return (
    <div
      aria-hidden="true"
      className={`stab-overlay${wiping ? " is-wiping" : ""}`}
      style={style}
    >
      {/* The flyer itself, in place, so the blade goes through the artwork. */}
      {f && (
        <div
          className="stab-flyer"
          style={
            {
              left: f.left,
              top: f.top,
              width: f.width,
              height: f.height,
              backgroundImage: f.src ? `url("${f.src}")` : undefined,
            } as React.CSSProperties
          }
        />
      )}
      {/* The stage shakes as one on impact: the blade, the slit and the splats. */}
      <div className="stab-stage">
        {/* The slit the blade opens, as the blade passes through the paper. */}
        <div className="stab-slit" />
        {/* The knife is thrown in from off-screen, spinning, and sticks. */}
        <div className="stab-knife">
          <div className="stab-knife-throw">
            <Knife />
          </div>
        </div>
        {/* Blood over the whole screen, then a dark red tint behind it. */}
        <div className="stab-tint" />
        {SCREEN_SPLATS.map((s, i) => (
          <div
            key={`screen-${i}`}
            className="stab-screen-splat"
            style={
              {
                width: `${s.size}vmax`,
                height: `${s.size}vmax`,
                "--ox": `${s.ox}vmax`,
                "--oy": `${s.oy}vmax`,
                animationDelay: `${s.delay}s`,
              } as React.CSSProperties
            }
          >
            <Blood id={`stab-blood-screen-${i}`} />
          </div>
        ))}
        {SPRAY.map((p, i) => (
          <span
            key={`spray-${i}`}
            className="stab-spray"
            style={
              {
                width: p.size,
                height: p.size,
                "--dx": `${p.dx}vmax`,
                "--dy": `${p.dy}vmax`,
                animationDelay: `${p.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
