/**
 * Drifting dust behind the whole site.
 *
 * Decorative only, so it is aria-hidden, ignores the pointer and sits at a
 * negative z-index - above the body's black, below everything anyone reads.
 * Motion is CSS transform/opacity so it stays on the compositor rather than
 * running a rAF loop and a canvas repaint on someone's phone all night.
 */

/**
 * mulberry32, fixed seed.
 *
 * The positions have to be identical in the HTML built at export time and in
 * the client's first render, or React reports a hydration mismatch and throws
 * the markup away. `Math.random()` cannot promise that; a seeded sequence can.
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

const rand = seeded(20260902);

/** Half of these are hidden below sm - see globals.css. */
const PARTICLES = Array.from({ length: 30 }, () => ({
  /** Column to rise through, as a percentage of the viewport. */
  left: rand() * 100,
  size: 1 + rand() * 1.6,
  /** Peak opacity. Dust, not snow: nothing here should read as a foreground. */
  opacity: 0.05 + rand() * 0.09,
  duration: 44 + rand() * 46,
  /** Negative, so every particle is already mid-flight on the first paint. */
  delay: rand() * -90,
  /** Sideways travel over one crossing, so they do not rise in parallel lines. */
  drift: (rand() - 0.5) * 14,
}));

export default function Particles() {
  return (
    <div className="particles" aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          style={
            {
              left: `${p.left.toFixed(3)}%`,
              width: `${p.size.toFixed(2)}px`,
              height: `${p.size.toFixed(2)}px`,
              animationDuration: `${p.duration.toFixed(2)}s`,
              animationDelay: `${p.delay.toFixed(2)}s`,
              "--p-opacity": p.opacity.toFixed(3),
              "--p-drift": `${p.drift.toFixed(2)}vw`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
