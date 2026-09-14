/**
 * Rainbow confetti drifting down behind the whole site, same idea as the
 * dust in Particles.tsx but falling rather than rising, and in color - the
 * one deliberately colorful thing on an otherwise black-and-silver site, so
 * it stays translucent and small rather than reading as a theme change.
 *
 * Decorative only, so it is aria-hidden, ignores the pointer and sits at a
 * negative z-index - above the body's black, below everything anyone reads.
 * Motion is CSS transform/opacity so it stays on the compositor rather than
 * running a rAF loop and a canvas repaint on someone's phone all night.
 */

/**
 * mulberry32, fixed seed - same reasoning as Particles.tsx: the positions
 * have to match between the static export's build-time HTML and the
 * client's first render, or hydration throws the markup away.
 */
function seeded(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seeded(20260914);

/** Half of these are hidden below sm - see globals.css. */
const CONFETTI = Array.from({ length: 24 }, () => ({
  /** Column to fall through, as a percentage of the viewport. */
  left: rand() * 100,
  width: 3 + rand() * 3,
  height: 2 + rand() * 3,
  /** Full spectrum - this is the one spot on the site allowed to be a rainbow. */
  hue: rand() * 360,
  /** Peak opacity. A hint of color, not a sticker - nothing here should read as a foreground. */
  opacity: 0.08 + rand() * 0.14,
  duration: 16 + rand() * 22,
  /** Negative, so every piece is already mid-fall on the first paint. */
  delay: rand() * -38,
  /** Sideways drift over one fall, so they do not fall in parallel lines. */
  drift: (rand() - 0.5) * 20,
  /** Full turns over one fall, direction picked per piece. */
  spin: (rand() < 0.5 ? -1 : 1) * (1 + rand() * 2),
}));

export default function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          style={
            {
              left: `${c.left.toFixed(3)}%`,
              width: `${c.width.toFixed(2)}px`,
              height: `${c.height.toFixed(2)}px`,
              animationDuration: `${c.duration.toFixed(2)}s`,
              animationDelay: `${c.delay.toFixed(2)}s`,
              "--c-hue": c.hue.toFixed(1),
              "--c-opacity": c.opacity.toFixed(3),
              "--c-drift": `${c.drift.toFixed(2)}vw`,
              "--c-spin": `${(c.spin * 360).toFixed(0)}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
