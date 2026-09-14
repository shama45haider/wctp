"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { btn, btnGo } from "@/lib/ui";
import { Editable } from "./Editable";

/**
 * Blackouts, drawn by the guest before the photo leaves the phone.
 *
 * The reviewer needs three things off a card: the photo, the name and the date
 * of birth. Everything else on it - the address, the card number, the
 * signature - is the guest's own business, and the point of this screen is
 * that they paint over it before anyone here sees it. What is handed back is
 * the painted copy; the original never leaves the browser. A stroke is flat,
 * opaque black rather than a blur, because a blur can be undone by somebody
 * patient and a black rectangle cannot.
 *
 * Drawn with pointer events so a finger, a stylus and a mouse are one code
 * path. Coordinates are mapped from the element's on-screen size to the
 * canvas's own, which is the image's: the canvas is shown at whatever width
 * the column gives it, and a pixel on screen is rarely a pixel of image.
 *
 * Undo keeps every stroke as a list of points and repaints the image under
 * them. Past MAX_UNDO the oldest are painted permanently onto a base copy of
 * the image instead of being dropped - a blackout that quietly vanished
 * because somebody scribbled a lot would be worse than one that can no longer
 * be undone.
 */

/** Long edge, in pixels. The same cap the camera uses, for the same reason. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.86;

/** Brush diameters in canvas pixels, against a long edge of at most 1600. */
const BRUSHES = [
  { size: 18, name: "THIN" },
  { size: 36, name: "MEDIUM" },
  { size: 64, name: "WIDE" },
] as const;

const MAX_UNDO = 120;

type Point = { x: number; y: number };
type Stroke = { size: number; points: Point[] };
type Status = "loading" | "ready" | "failed";

function inkOn(ctx: CanvasRenderingContext2D, size: number) {
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
}

/** A whole stroke. A single tap is a dot, which a zero-length line is not everywhere. */
function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  inkOn(ctx, stroke.size);
  const [first, ...rest] = stroke.points;
  if (!first) return;
  if (rest.length === 0) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  rest.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.stroke();
}

/** The newest piece of a stroke in progress, so the finger never waits on a full repaint. */
function paintSegment(ctx: CanvasRenderingContext2D, size: number, from: Point, to: Point) {
  inkOn(ctx, size);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

export default function IdRedactor({
  source,
  onDone,
  onBack,
}: {
  source: Blob;
  /** The painted copy, as a JPEG. */
  onDone: (blob: Blob) => void;
  onBack: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The decoded photo, kept so Clear can start again from it. */
  const imageRef = useRef<HTMLImageElement | null>(null);
  /** The photo plus every stroke that has fallen off the undo stack. */
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  /** The stroke under the finger right now, and which pointer is drawing it. */
  const drawingRef = useRef<{ id: number; stroke: Stroke } | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [brush, setBrush] = useState<number>(BRUSHES[1].size);
  const [strokeCount, setStrokeCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The source goes into an <img> through a blob URL, and from there onto the
  // canvas at the working size. The URL stays alive as long as the screen
  // does: the image element is what Clear repaints from, and a browser under
  // memory pressure may go back to the URL to decode it again.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let live = true;
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const base = document.createElement("canvas");
      base.width = width;
      base.height = height;
      base.getContext("2d")!.drawImage(img, 0, 0, width, height);

      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(base, 0, 0);

      imageRef.current = img;
      baseRef.current = base;
      strokesRef.current = [];
      drawingRef.current = null;
      setStrokeCount(0);
      setStatus("ready");
    };
    // A HEIC on a browser that cannot decode one lands here, and so does a
    // file that only claimed to be an image.
    img.onerror = () => {
      if (live) setStatus("failed");
    };
    img.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [source]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    strokesRef.current.forEach((s) => paintStroke(ctx, s));
  }, []);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  // One pointer at a time. A second finger landing mid-stroke is ignored
  // rather than joined to the first, which would draw a line across the card
  // between them.
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (status !== "ready" || busy || drawingRef.current) return;
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const stroke: Stroke = { size: brush, points: [pointOf(e)] };
    drawingRef.current = { id: e.pointerId, stroke };
    paintStroke(canvas.getContext("2d")!, stroke);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (!drawing || drawing.id !== e.pointerId) return;
    const next = pointOf(e);
    const prev = drawing.stroke.points[drawing.stroke.points.length - 1];
    drawing.stroke.points.push(next);
    paintSegment(e.currentTarget.getContext("2d")!, drawing.stroke.size, prev, next);
  };

  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (!drawing || drawing.id !== e.pointerId) return;
    drawingRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const strokes = strokesRef.current;
    strokes.push(drawing.stroke);
    if (strokes.length > MAX_UNDO && baseRef.current) {
      paintStroke(baseRef.current.getContext("2d")!, strokes.shift()!);
    }
    setStrokeCount(strokes.length);
  };

  const undo = () => {
    if (drawingRef.current) return;
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redraw();
  };

  const clear = () => {
    const base = baseRef.current;
    const img = imageRef.current;
    if (drawingRef.current || !base || !img) return;
    base.getContext("2d")!.drawImage(img, 0, 0, base.width, base.height);
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
  };

  const finish = () => {
    const canvas = canvasRef.current;
    if (!canvas || status !== "ready" || drawingRef.current) return;
    setBusy(true);
    setMessage(null);
    canvas.toBlob(
      (blob) => {
        if (!alive.current) return;
        if (!blob) {
          setBusy(false);
          setMessage("The picture could not be saved. Try again.");
          return;
        }
        onDone(blob);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  };

  if (status === "failed") {
    return (
      <>
        <p
          role="alert"
          className="label mt-6 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
        >
          THAT FORMAT CAN&rsquo;T BE OPENED HERE. TAKE A PHOTO WITH THE CAMERA
          INSTEAD, OR SEND A JPG OR PNG.
        </p>
        <button onClick={onBack} className={`${btn} mt-6 w-full`}>
          Back
        </button>
      </>
    );
  }

  const ready = status === "ready";

  return (
    <>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        <Editable k="idRedactor.intro">
          Black out anything you&rsquo;d rather we didn&rsquo;t see - the
          address, the card number. Leave your photo, your name and your date of
          birth readable, or it can&rsquo;t be approved.
        </Editable>
      </p>

      <div className="mt-6 border border-line bg-ink p-2">
        {!ready && (
          <p className="label flex aspect-[4/3] items-center justify-center text-silverfaint">
            OPENING THE PHOTO…
          </p>
        )}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Your ID. Draw on it to black parts out."
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className={`h-auto w-full touch-none select-none [-webkit-touch-callout:none] ${
            ready ? "cursor-crosshair" : "hidden"
          }`}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="label mr-1 text-silverfaint">BRUSH</span>
        {BRUSHES.map((b) => (
          <button
            key={b.size}
            type="button"
            aria-pressed={brush === b.size}
            onClick={() => setBrush(b.size)}
            disabled={!ready || busy}
            className={`label min-h-11 flex-1 border transition-colors disabled:opacity-50 ${
              brush === b.size
                ? "border-bloodhi text-chalk"
                : "border-line text-silverdim hover:border-linehi hover:text-chalk"
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={undo}
          disabled={!ready || busy || strokeCount === 0}
          className={`${btn} flex-1`}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={!ready || busy || strokeCount === 0}
          className={`${btn} flex-1`}
        >
          Clear
        </button>
      </div>

      {message && (
        <p
          role="alert"
          className="label mt-4 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
        >
          {message}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <button onClick={finish} disabled={!ready || busy} className={btnGo}>
          {busy ? "Saving…" : "Done"}
        </button>
        <button onClick={onBack} disabled={busy} className={btn}>
          Back
        </button>
      </div>
    </>
  );
}
