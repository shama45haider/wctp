"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseAamva, type ScanResult } from "@/lib/aamva";

/**
 * Reads the PDF417 barcode on the back of a driver's licence or state ID.
 *
 * The decode happens in this browser and the frames never leave the device -
 * no photo is uploaded and nothing is sent anywhere. What the caller receives
 * is the parsed result; what gets stored is the caller's decision, and should
 * be as little of it as the door actually needs.
 *
 * ZXing is pulled in on demand rather than imported at the top. It is a large
 * dependency, and most visits to this site never open a scanner - loading it
 * eagerly would put it in the bundle for everyone who only wanted a ticket.
 */

type Phase = "idle" | "starting" | "scanning" | "denied" | "unsupported";

export default function IdScanner({
  onResult,
  onCancel,
}: {
  onResult: (r: ScanResult) => void;
  onCancel?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Camera keeps running until the component goes away, so release it on
  // unmount - a live camera light left on after navigating away reads as a bug
  // whether or not it is one.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setPhase("unsupported");
    setPhase("starting");

    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");

      const hints = new Map();
      // PDF417 only. Narrowing the formats makes each frame markedly cheaper,
      // which matters when this is running on a phone at a door.
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints);

      // The barcode on an ID is dense, so ask for the highest resolution the
      // camera will give: at 640x480 the bars blur together and nothing reads.
      const controls = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoRef.current!,
        (result) => {
          if (!result) return;
          const parsed = parseAamva(result.getText());
          // Keep scanning through barcodes that are not IDs rather than
          // reporting a failure the moment something else drifts into frame.
          if (!parsed.ok && parsed.reason === "not-an-id") return;
          controls.stop();
          stop();
          onResult(parsed);
        },
      );

      stopRef.current = () => controls.stop();
      setPhase("scanning");

      const track = (videoRef.current?.srcObject as MediaStream | null)
        ?.getVideoTracks?.()[0];
      setHasTorch(Boolean((track?.getCapabilities?.() as never as { torch?: boolean })?.torch));
    } catch (err) {
      const name = (err as Error)?.name;
      setPhase(name === "NotAllowedError" ? "denied" : "unsupported");
    }
  }, [onResult, stop]);

  const toggleTorch = useCallback(async () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)
      ?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as never],
      });
      setTorchOn(next);
    } catch {
      setHasTorch(false);
    }
  }, [torchOn]);

  return (
    <div className="mt-6">
      <div className="relative overflow-hidden border border-line bg-ink">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`aspect-[4/3] w-full object-cover ${
            phase === "scanning" ? "" : "opacity-0"
          }`}
        />

        {phase === "scanning" && (
          // A guide rather than a crop: the reader still sees the whole frame,
          // but people line a card up against a box far more accurately than
          // against nothing.
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-[38%] w-[82%] border-2 border-bloodhi/70" />
          </div>
        )}

        {phase !== "scanning" && (
          <div className="flex aspect-[4/3] flex-col items-center justify-center px-6 text-center">
            {phase === "idle" && (
              <p className="label leading-loose text-silverfaint">
                HOLD THE BACK OF YOUR LICENCE UP TO THE CAMERA.
                <br />
                NOTHING IS UPLOADED - IT IS READ ON THIS DEVICE.
              </p>
            )}
            {phase === "starting" && (
              <p className="label text-silverfaint">STARTING CAMERA…</p>
            )}
            {phase === "denied" && (
              <p className="label leading-loose text-bloodhi">
                CAMERA ACCESS WAS REFUSED.
                <br />
                ALLOW IT IN YOUR BROWSER SETTINGS, OR SUBMIT ANOTHER ID INSTEAD.
              </p>
            )}
            {phase === "unsupported" && (
              <p className="label leading-loose text-bloodhi">
                THIS BROWSER CANNOT OPEN THE CAMERA.
                <br />
                SUBMIT ANOTHER FORM OF ID INSTEAD.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {phase === "idle" && (
          <button
            onClick={start}
            className="font-display min-h-11 flex-1 border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] px-6 tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi"
          >
            Start scan
          </button>
        )}

        {phase === "scanning" && hasTorch && (
          <button
            onClick={toggleTorch}
            aria-pressed={torchOn}
            className="font-display min-h-11 flex-1 border border-linehi px-6 tracking-[0.12em] text-chalk uppercase transition-colors hover:border-silverdim"
          >
            {torchOn ? "Light off" : "Light on"}
          </button>
        )}

        {(phase === "scanning" || phase === "starting") && (
          <button
            onClick={() => {
              stop();
              setPhase("idle");
            }}
            className="font-display min-h-11 flex-1 border border-line px-6 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-linehi hover:text-chalk"
          >
            Stop
          </button>
        )}

        {onCancel && (
          <button
            onClick={() => {
              stop();
              onCancel();
            }}
            className="label min-h-11 px-2 text-silverfaint underline transition-colors hover:text-chalk"
          >
            USE ANOTHER ID
          </button>
        )}
      </div>
    </div>
  );
}
