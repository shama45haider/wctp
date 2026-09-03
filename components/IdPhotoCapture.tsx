"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { btn, btnGo } from "@/lib/ui";

/**
 * A photo of the front of the card, taken right after the barcode on the back
 * has been read.
 *
 * The barcode carries no picture - the AAMVA format has nowhere to put one -
 * so the portrait a door actually compares a face against has to come from
 * the camera. This runs the same camera IdScanner just released, without the
 * decoder: a live preview, a shutter, a look at the still, and then it goes
 * to the private id-documents bucket and is recorded against the guest through
 * record_barcode_verification in 0005, which is the only route that may file a
 * barcode check as approved.
 *
 * Skippable on purpose. The age check already cleared in the previous step and
 * nothing about a camera that will not focus, or a guest who would rather not,
 * should un-clear it. What skipping costs is the photo on the admin's screen,
 * and the copy says so.
 */

const BUCKET = "id-documents";
const UPLOAD_TIMEOUT_MS = 90_000;
const RECORD_TIMEOUT_MS = 10_000;
/** JPEG at this quality is a few hundred KB from a phone camera - plenty to read a card. */
const JPEG_QUALITY = 0.86;
/** Long edge, in pixels. A 4000px still is not more legible, only slower to send. */
const MAX_EDGE = 1600;

type Phase =
  | "idle"
  | "starting"
  | "live"
  | "denied"
  | "unsupported"
  | "review"
  | "sending"
  | "sent"
  | "failed";

function capped<T>(work: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

export default function IdPhotoCapture({
  birthYear,
  onDone,
  onSkip,
}: {
  birthYear: number;
  /** Photo uploaded and recorded. */
  onDone: () => void;
  /** Guest declined, or nothing could be captured. The check still stands. */
  onSkip: () => void;
}) {
  const { user } = useSupabaseAuth();
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

  // The still is a blob URL, held until revoked and the bytes with it.
  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setPhase("unsupported");
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
  }, []);

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

  const send = async () => {
    if (!shot || !user) return;
    const supabase = safeClient();
    if (!supabase) {
      setPhase("failed");
      return setMessage("Not connected. This build cannot save a photo.");
    }

    setPhase("sending");
    setMessage(null);

    // First segment must be this user's id or the storage policy in 0003
    // refuses the write. The timestamp keeps a retake from colliding.
    const path = `${user.id}/${Date.now()}-licence-front.jpg`;

    const up = await capped(
      supabase.storage.from(BUCKET).upload(path, shot.blob, {
        contentType: "image/jpeg",
        upsert: false,
      }),
      UPLOAD_TIMEOUT_MS,
    );
    if (!alive.current) return;

    if (!up) {
      setPhase("failed");
      return setMessage("The upload did not finish. Check your connection and try again.");
    }
    if (up.error) {
      setPhase("failed");
      return setMessage(
        /bucket/i.test(up.error.message) && /not found/i.test(up.error.message)
          ? "This project has not run migration 0003, so there is nowhere to put the photo yet."
          : `The photo could not be uploaded: ${up.error.message}`,
      );
    }

    // The one route allowed to file a barcode check as approved. A raw insert
    // is pending-only by policy, which is the point of the function existing.
    const rec = await capped(
      supabase.rpc("record_barcode_verification", {
        p_birth_year: birthYear,
        p_document_path: path,
        p_document_kind: "Licence front (with barcode scan)",
      }),
      RECORD_TIMEOUT_MS,
    );
    if (!alive.current) return;

    if (!rec || rec.error) {
      setPhase("failed");
      const why = rec?.error?.message ?? "";
      return setMessage(
        /function|does not exist|schema cache/i.test(why)
          ? `Your photo is saved, but this project has not run migration 0005, so it could not be recorded against your account yet. Quote ${path} if you need to.`
          : `Your photo is saved, but recording it failed${why ? `: ${why}` : ""}. Quote ${path} if you need to.`,
      );
    }

    setPhase("sent");
    onDone();
  };

  if (!user) {
    return (
      <>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          The session ended before the photo could be saved. The age check
          still stands.
        </p>
        <button onClick={onSkip} className={`${btn} mt-6 w-full`}>
          Continue
        </button>
      </>
    );
  }

  const busy = phase === "sending";

  return (
    <>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        Now the <strong className="text-chalk">front</strong> - the side with
        your photo. The door matches it to your face on the night.
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

        {(phase === "review" || phase === "sending" || phase === "sent" || phase === "failed") && shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.url} alt="The front of your ID, before sending it" className="aspect-[4/3] w-full object-cover" />
        )}

        {(phase === "idle" || phase === "starting" || phase === "denied" || phase === "unsupported") && (
          <div className="flex aspect-[4/3] flex-col items-center justify-center px-6 text-center">
            {phase === "idle" && (
              <p className="label leading-loose text-silverfaint">
                FLIP THE CARD OVER AND HOLD THE FRONT UP TO THE CAMERA.
              </p>
            )}
            {phase === "starting" && <p className="label text-silverfaint">STARTING CAMERA…</p>}
            {phase === "denied" && (
              <p className="label leading-loose text-bloodhi">
                CAMERA ACCESS WAS REFUSED. YOU CAN SKIP THIS - THE AGE CHECK STILL STANDS.
              </p>
            )}
            {phase === "unsupported" && (
              <p className="label leading-loose text-bloodhi">
                THIS BROWSER CANNOT OPEN THE CAMERA. YOU CAN SKIP THIS.
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
        {phase === "live" && (
          <button onClick={() => void snap()} className={btnGo}>
            Take the photo
          </button>
        )}
        {phase === "review" && (
          <>
            <button onClick={() => void send()} className={btnGo}>
              Use this photo
            </button>
            <button onClick={retake} className={btn}>
              Retake
            </button>
          </>
        )}
        {phase === "sending" && (
          <button disabled className={btnGo}>
            Sending…
          </button>
        )}
        {phase === "failed" && (
          <>
            <button onClick={() => void send()} className={btnGo}>
              Try sending again
            </button>
            <button onClick={retake} className={btn}>
              Retake
            </button>
          </>
        )}

        {phase !== "sending" && phase !== "sent" && (
          <button
            onClick={() => {
              stop();
              onSkip();
            }}
            disabled={busy}
            className="label min-h-11 text-silverfaint transition-colors hover:text-chalk"
          >
            SKIP FOR NOW
          </button>
        )}
      </div>
    </>
  );
}
