"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { btn, btnGo } from "@/lib/ui";
import { Editable } from "./Editable";

/**
 * The camera, for a guest who would rather photograph their ID here than dig
 * one out of the photo roll.
 *
 * A live preview, a shutter, a look at the still - and then the still goes
 * back to whoever mounted this, as a JPEG blob. Nothing is uploaded from here
 * and nothing is decided: the photo goes on to the redactor, where the guest
 * blacks out what the door does not need, and only after that to the review
 * queue. This used to be the second half of a barcode scan; the scan is gone,
 * and with it any idea that a camera could clear its own owner.
 *
 * The still is sized down before it is encoded. A 4000px frame is no more
 * legible than a 1600px one, only slower to draw on and slower to send.
 */

/** JPEG at this quality is a few hundred KB from a phone camera - plenty to read a card. */
const JPEG_QUALITY = 0.86;
/** Long edge, in pixels. */
const MAX_EDGE = 1600;

type Phase = "idle" | "starting" | "live" | "denied" | "unsupported" | "review";

export default function IdCamera({
  onCapture,
  onCancel,
}: {
  /** The guest is happy with the still. The camera is already off. */
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const stop = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Camera off on the way out, whatever state this was in. A camera light
  // still on after the screen has gone reads as a bug whether or not it is.
  useEffect(() => stop, [stop]);

  // The still is a blob URL, held until revoked and the bytes with it. Each
  // one goes when the next replaces it, and the last one goes with the screen.
  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setPhase("unsupported");
    stop();
    setPhase("starting");
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: "continuous" } as never],
        },
      });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setPhase("live");
    } catch (err) {
      const name = (err as Error)?.name;
      setPhase(name === "NotAllowedError" ? "denied" : "unsupported");
    }
  }, [stop]);

  /** One frame off the live video, sized down and encoded, then the camera stops. */
  const snap = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!alive.current) return;
    if (!blob) {
      setMessage("The camera gave nothing back. Try once more.");
      return;
    }

    stop();
    setShot({ blob, url: URL.createObjectURL(blob) });
    setPhase("review");
  }, [stop]);

  const retake = () => {
    setShot(null);
    setMessage(null);
    void start();
  };

  const accept = () => {
    if (!shot) return;
    stop();
    onCapture(shot.blob);
  };

  const leave = () => {
    stop();
    onCancel();
  };

  return (
    <>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        <Editable k="idCamera.intro">
          Hold your ID up to the camera. Every line should be readable - you can
          black out the parts you&rsquo;d rather keep to yourself on the next
          screen.
        </Editable>
      </p>

      <div className="relative mt-6 overflow-hidden border border-line bg-ink">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`aspect-[4/3] w-full object-cover ${phase === "live" ? "" : "hidden"}`}
        />

        {phase === "live" && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[62%] w-[86%] border-2 border-bloodhi/70" />
          </div>
        )}

        {phase === "review" && shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.url} alt="Your ID, before you black anything out" className="aspect-[4/3] w-full object-cover" />
        )}

        {(phase === "idle" || phase === "starting" || phase === "denied" || phase === "unsupported") && (
          <div className="flex aspect-[4/3] flex-col items-center justify-center px-6 text-center">
            {phase === "idle" && (
              <p className="label leading-loose text-silverfaint">
                <Editable k="idCamera.idle">
                  HOLD YOUR ID UP TO THE CAMERA. EVERY LINE SHOULD BE READABLE.
                </Editable>
              </p>
            )}
            {phase === "starting" && <p className="label text-silverfaint">STARTING CAMERA…</p>}
            {phase === "denied" && (
              <p className="label leading-loose text-bloodhi">
                CAMERA ACCESS WAS REFUSED. GO BACK AND UPLOAD A PHOTO INSTEAD.
              </p>
            )}
            {phase === "unsupported" && (
              <p className="label leading-loose text-bloodhi">
                THIS BROWSER CANNOT OPEN THE CAMERA. GO BACK AND UPLOAD A PHOTO INSTEAD.
              </p>
            )}
          </div>
        )}
      </div>

      {message && (
        <p role="alert" className="label mt-4 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi">
          {message}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {phase === "idle" && (
          <button onClick={() => void start()} className={btnGo}>
            Open the camera
          </button>
        )}
        {phase === "starting" && (
          <button disabled className={btnGo}>
            Starting…
          </button>
        )}
        {phase === "live" && (
          <button onClick={() => void snap()} className={btnGo}>
            Take the photo
          </button>
        )}
        {(phase === "denied" || phase === "unsupported") && (
          <button onClick={() => void start()} className={btnGo}>
            Try the camera again
          </button>
        )}
        {phase === "review" && (
          <>
            <button onClick={accept} className={btnGo}>
              Use this photo
            </button>
            <button onClick={retake} className={btn}>
              Retake
            </button>
          </>
        )}
        <button onClick={leave} disabled={phase === "starting"} className={btn}>
          Back
        </button>
      </div>
    </>
  );
}
