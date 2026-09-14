"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The live draw's wheel: one slice per entrant, their picture near the rim and
 * their handle along the slice, drawn once to a canvas and spun with a CSS
 * transform so the spin itself stays on the compositor.
 *
 * Slice i covers the angle from i/n to (i+1)/n of a turn, measured clockwise
 * from the top, where the pointer is. landingRotation() is the inverse: the
 * rotation that puts a given point inside a given slice under the pointer.
 */

export type WheelEntrant = { key: string; handle: string; avatarUrl: string | null };

/**
 * Degrees to rotate to so the pointer lands `offset` (0..1) of the way into
 * slice `index` - always forwards from `from`, after `turns` full turns.
 */
export function landingRotation(
  from: number,
  index: number,
  count: number,
  offset: number,
  turns = 7,
): number {
  if (count <= 0) return from;
  const slice = 360 / count;
  const local = (index + offset) * slice;
  const base = Math.ceil(from / 360) * 360;
  return base + turns * 360 + ((360 - local) % 360);
}

const MAX_DPR = 2;

function drawWheel(
  ctx: CanvasRenderingContext2D,
  size: number,
  entrants: WheelEntrant[],
  images: Map<string, HTMLImageElement>,
  highlightKey: string | null,
) {
  const r = size / 2;
  const outer = r - 3;
  ctx.clearRect(0, 0, size, size);

  const styles = getComputedStyle(document.body);
  const display = styles.getPropertyValue("--font-display").trim() || "sans-serif";
  const mono = styles.getPropertyValue("--font-mono").trim() || "monospace";

  const n = entrants.length;
  if (n === 0) {
    ctx.beginPath();
    ctx.arc(r, r, outer, 0, Math.PI * 2);
    ctx.fillStyle = "#0c0d10";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#3a3f47";
    ctx.stroke();
    ctx.fillStyle = "#7a8089";
    ctx.font = `600 ${Math.max(11, size * 0.03)}px ${mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("NOBODY ON THE WHEEL", r, r);
    return;
  }

  const slice = (Math.PI * 2) / n;
  /** Width of a slice at `radius` - the room there is for a picture or text. */
  const room = (radius: number) => (n === 1 ? radius * 2 : 2 * radius * Math.sin(slice / 2));

  for (let i = 0; i < n; i++) {
    const e = entrants[i];
    const start = -Math.PI / 2 + i * slice;
    const mid = start + slice / 2;

    const hue = ((i * 360) / Math.max(n, 7) + 40) % 360;
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, outer, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = `hsl(${hue} 62% ${i % 2 === 0 ? 44 : 33}%)`;
    ctx.fill();
    if (n > 1) {
      ctx.lineWidth = n > 90 ? 0.6 : 1.5;
      ctx.strokeStyle = "rgba(5, 5, 5, 0.85)";
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(mid);

    // Picture near the rim. Turned a quarter so its top faces outwards: the
    // slice under the pointer at the top shows its face the right way up.
    const avatarR = Math.min(r * 0.085, room(outer * 0.82) * 0.42);
    const avatarX = outer - avatarR - r * 0.045;
    const hasAvatar = avatarR >= 6;
    if (hasAvatar) {
      ctx.beginPath();
      ctx.arc(avatarX, 0, avatarR, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = "#050505";
      ctx.fill();

      const img = e.avatarUrl ? images.get(e.avatarUrl) : undefined;
      ctx.save();
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.clip();
        ctx.translate(avatarX, 0);
        ctx.rotate(Math.PI / 2);
        const cover = Math.max((avatarR * 2) / img.naturalWidth, (avatarR * 2) / img.naturalHeight);
        const w = img.naturalWidth * cover;
        const h = img.naturalHeight * cover;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.translate(avatarX, 0);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = "#c9cdd4";
        ctx.font = `900 ${avatarR * 1.1}px ${display}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((e.handle[0] ?? "?").toUpperCase(), 0, avatarR * 0.06);
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(avatarX, 0, avatarR, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, avatarR * 0.12);
      ctx.strokeStyle = "rgba(242, 244, 247, 0.85)";
      ctx.stroke();
    }

    // Handle along the slice, when there's room to read it.
    const fontPx = Math.min(r * 0.05, room(outer * 0.55) * 0.62);
    if (fontPx >= 7.5) {
      const endX = (hasAvatar ? avatarX - avatarR : outer) - r * 0.035;
      ctx.fillStyle = "#f2f4f7";
      ctx.font = `600 ${fontPx}px ${mono}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(e.handle === "member" ? "member" : `@${e.handle}`, endX, 0, Math.max(0, endX - r * 0.2));
    }

    ctx.restore();
  }

  if (highlightKey) {
    const i = entrants.findIndex((e) => e.key === highlightKey);
    if (i >= 0) {
      const start = -Math.PI / 2 + i * slice;
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.arc(r, r, outer, start, start + slice);
      ctx.closePath();
      ctx.lineWidth = Math.max(3, size * 0.009);
      ctx.strokeStyle = "#f6e27a";
      ctx.stroke();
    }
  }

  ctx.beginPath();
  ctx.arc(r, r, outer, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(3, size * 0.01);
  ctx.strokeStyle = "#f2f4f7";
  ctx.stroke();

  const hub = r * 0.15;
  ctx.beginPath();
  ctx.arc(r, r, hub, 0, Math.PI * 2);
  ctx.fillStyle = "#050505";
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.008);
  ctx.strokeStyle = "#f6e27a";
  ctx.stroke();
  ctx.fillStyle = "#f2f4f7";
  ctx.font = `900 ${hub * 0.62}px ${display}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("WCTP", r, r + hub * 0.04);
}

export default function RaffleWheel({
  entrants,
  rotation,
  spinMs,
  highlightKey = null,
}: {
  entrants: WheelEntrant[];
  rotation: number;
  /** Length of the transition to `rotation`; 0 jumps straight there. */
  spinMs: number;
  highlightKey?: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [size, setSize] = useState(0);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pictures load in the background; each one that lands triggers a redraw,
  // batched to one per frame so a wheel of fifty doesn't redraw fifty times.
  useEffect(() => {
    let frame = 0;
    for (const e of entrants) {
      if (!e.avatarUrl || images.current.has(e.avatarUrl)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => setLoaded((n) => n + 1));
      };
      img.src = e.avatarUrl;
      images.current.set(e.avatarUrl, img);
    }
    return () => cancelAnimationFrame(frame);
  }, [entrants]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || size === 0) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    el.width = Math.round(size * dpr);
    el.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWheel(ctx, size, entrants, images.current, highlightKey);
  }, [entrants, size, loaded, highlightKey]);

  return (
    <div className="relative mx-auto w-full max-w-[640px]">
      <div
        aria-hidden="true"
        className="raffle-wheel-glow pointer-events-none absolute inset-[-8%] rounded-full"
      />
      <div ref={wrap} className="relative aspect-square w-full">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Raffle wheel with ${entrants.length} ${entrants.length === 1 ? "entry" : "entries"}`}
          className="absolute inset-0 h-full w-full rounded-full will-change-transform"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinMs > 0 ? `transform ${spinMs}ms cubic-bezier(0.12, 0.7, 0.1, 1)` : "none",
          }}
        />
      </div>
      <svg
        viewBox="0 0 32 40"
        aria-hidden="true"
        className="absolute top-0 left-1/2 z-10 h-11 w-9 -translate-x-1/2 -translate-y-[38%] drop-shadow-[0_6px_14px_rgba(0,0,0,0.8)]"
      >
        <path d="M16 39 2.6 8.5A15 15 0 1 1 29.4 8.5Z" fill="#f6e27a" stroke="#050505" strokeWidth="2" />
        <circle cx="16" cy="14" r="4.5" fill="#050505" />
      </svg>
    </div>
  );
}
