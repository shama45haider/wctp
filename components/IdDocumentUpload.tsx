"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import IdCamera from "./IdCamera";
import IdRedactor from "./IdRedactor";
import { org } from "@/lib/events";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * The age check: a photo of an ID and a date of birth, left for a person to
 * look at.
 *
 * This is the only way a check gets filed. There used to be a barcode reader
 * beside it that could clear a licence holder on the spot; it is gone, and
 * nothing in the browser can clear anybody now. What this files is a row in
 * the queue, status "pending", that an admin later reads in app/admin - and
 * the guest is told as much rather than shown a tick that means nothing.
 *
 * Four steps: where the photo comes from (the camera, or a file), the
 * blackouts, the details, the send. The blackouts are why this is longer than
 * "pick a file". A licence carries an address and a card number, the reviewer
 * needs neither, and a guest should not have to hand them over to prove a
 * year of birth - so they paint over whatever the door does not need before
 * anything is sent, and only the painted copy ever leaves the phone.
 *
 * The date of birth is typed rather than read off the document because the
 * point of it is disagreement: an admin comparing what somebody claimed
 * against what the card says learns something that either one alone does not.
 * Only the year of it is ever stored - see the birth_year column in
 * supabase/migrations/0002_admin_events_verification.sql.
 */

const MIN_AGE = 18;

/** 8MB. Phone cameras clear this comfortably; a scanner's TIFF will not. */
const MAX_BYTES = 8 * 1024 * 1024;

const BUCKET = "id-documents";

/**
 * Upload gets far longer than the rest of the site allows a request.
 *
 * Everything else here is a few hundred bytes of JSON, but this is a photo
 * going up a phone's uplink from inside a venue. Eight seconds would abandon
 * uploads that were going to finish.
 */
const UPLOAD_TIMEOUT_MS = 90_000;
const RECORD_TIMEOUT_MS = 10_000;

/** What the reviewer will be looking at, in their words rather than a slug. */
const KINDS = [
  "Driver's licence",
  "Student ID",
  "College ID",
  "Passport",
  "State ID",
  "Other",
] as const;

type Step =
  | { k: "source" }
  | { k: "camera" }
  | { k: "redact"; source: Blob }
  | { k: "details"; source: Blob; redacted: Blob };

type Phase = "idle" | "uploading" | "submitted" | "error";

/**
 * Age in whole years, or null if the string is not a date.
 *
 * Parsed field by field rather than through `new Date(dob)`, which reads a
 * bare `YYYY-MM-DD` as midnight UTC - west of Greenwich that is the previous
 * day, and a birthday on the first of a month would come out a year short.
 */
function ageFrom(dob: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;

  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const now = new Date();
  const thisMonth = now.getMonth() + 1;

  let age = now.getFullYear() - year;
  if (thisMonth < month || (thisMonth === month && now.getDate() < day)) age -= 1;
  return age;
}

function megabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `work`, or null if it has not answered inside `ms`. */
function capped<T>(work: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** getSupabase parses the project URL on its first call, and can throw on it. */
function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

export default function IdDocumentUpload({
  onSubmitted,
  onBack,
}: {
  onSubmitted: () => void;
  /** Leaving without filing anything. Only offered from the first step. */
  onBack: () => void;
}) {
  const { ready, user } = useSupabaseAuth();

  const [step, setStep] = useState<Step>({ k: "source" });
  const [preview, setPreview] = useState<string | null>(null);
  const [dob, setDob] = useState("");
  const [kind, setKind] = useState<string>(KINDS[0]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A blob URL is held by the document until it is revoked, and the bytes
  // behind it with it. Going back to the blackouts and coming out again is
  // the normal way this screen gets used, so each preview is released as it
  // is replaced, and the last one on the way out.
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const showPreview = (blob: Blob | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = blob ? URL.createObjectURL(blob) : null;
    setPreview(previewRef.current);
  };

  if (!ready) {
    return <p className="label mt-6 text-silverfaint">CHECKING YOUR SESSION…</p>;
  }

  if (!user) {
    return (
      <>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          {isSupabaseConfigured
            ? "Sending an ID needs an account, so we know whose age check it is and where to write back."
            : "This build has no account service connected, so there is nowhere to send an ID."}
        </p>
        <div className="mt-7 flex flex-col gap-3">
          {isSupabaseConfigured && (
            <Link href="/login" className={btnGo}>
              Sign in
            </Link>
          )}
          <button onClick={onBack} className={btn}>
            Back
          </button>
        </div>
      </>
    );
  }

  const age = dob ? ageFrom(dob) : null;
  const underage = age !== null && age >= 0 && age < MIN_AGE;
  const futureDob = age !== null && age < 0;
  const busy = phase === "uploading";
  const sent = phase === "submitted";

  const goTo = (next: Step) => {
    setMessage(null);
    setPhase("idle");
    if (next.k !== "details") showPreview(null);
    setStep(next);
  };

  /** A file from the picker, checked before it is worth opening. */
  const choose = (picked: File | null) => {
    if (!picked) return;
    setMessage(null);
    setPhase("idle");

    // Some phones hand over a HEIC with an empty type rather than image/heic,
    // so an empty type falls back to the extension instead of being refused.
    const looksLikeImage = picked.type
      ? picked.type.startsWith("image/")
      : /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(picked.name);

    if (!looksLikeImage) {
      setPhase("error");
      setMessage(
        "That is not an image. Send a photo of the document - a PDF or a document file will not do.",
      );
      return;
    }

    if (picked.size > MAX_BYTES) {
      setPhase("error");
      setMessage(
        `That photo is ${megabytes(picked.size)}, and the limit is ${megabytes(
          MAX_BYTES,
        )}. Take it again at a lower resolution, or send a smaller copy.`,
      );
      return;
    }

    goTo({ k: "redact", source: picked });
  };

  const redacted = (source: Blob, blob: Blob) => {
    showPreview(blob);
    setMessage(null);
    setPhase("idle");
    setStep({ k: "details", source, redacted: blob });
  };

  const submit = async () => {
    if (step.k !== "details") return;
    if (age === null) {
      setPhase("error");
      return setMessage("Enter your date of birth.");
    }
    if (futureDob) {
      setPhase("error");
      return setMessage("That date has not happened yet.");
    }
    // Refused here rather than filed and rejected later: a row that cannot end
    // in approval wastes the reviewer's time and the guest's evening.
    if (underage) {
      setPhase("error");
      return setMessage(
        `Our nights are ${MIN_AGE}+, and that date of birth makes you ${age}. There is nothing to review yet.`,
      );
    }

    const supabase = safeClient();
    if (!supabase) {
      setPhase("error");
      return setMessage("Not connected. This build cannot accept an upload.");
    }

    setPhase("uploading");
    setMessage(null);

    // The first folder segment has to be this user's id or the policy in
    // 0003_storage_fix.sql refuses the write outright. The timestamp keeps a
    // second attempt from colliding with the first, which upsert:false would
    // otherwise reject as a duplicate. Always a JPEG: it is the redactor's
    // output, whatever the guest started from.
    const path = `${user.id}/${Date.now()}-id.jpg`;

    try {
      const up = await capped(
        supabase.storage.from(BUCKET).upload(path, step.redacted, {
          contentType: "image/jpeg",
          upsert: false,
        }),
        UPLOAD_TIMEOUT_MS,
      );
      if (!alive.current) return;

      if (!up) {
        setPhase("error");
        return setMessage(
          "The upload did not finish. Check your connection and try again - nothing was saved.",
        );
      }
      if (up.error) {
        setPhase("error");
        return setMessage(`The photo could not be uploaded: ${up.error.message}`);
      }

      // Pending, and only ever pending. The policy in 0011 refuses anything
      // else from a guest's session, and this is the one place that files it.
      const row = await capped(
        supabase.from("verifications").insert({
          user_id: user.id,
          method: "document",
          status: "pending",
          // Year only. The day and month were for the reviewer to compare
          // against the card, and they have no business in the database.
          birth_year: Number(dob.slice(0, 4)),
          document_path: path,
          document_kind: kind,
        }),
        RECORD_TIMEOUT_MS,
      );
      if (!alive.current) return;

      // The photo is up but nothing points at it, so nobody will ever be shown
      // it. Reporting success here would leave somebody waiting on a review
      // that was never queued.
      if (!row || row.error) {
        setPhase("error");
        return setMessage(
          `Your photo uploaded, but we could not add it to the review queue${
            row?.error ? `: ${row.error.message}` : ""
          }. Try again, or email ${org.email} and quote ${path}.`,
        );
      }

      setPhase("submitted");
      onSubmitted();
    } catch (e) {
      if (!alive.current) return;
      setPhase("error");
      setMessage(
        e instanceof Error && e.message
          ? e.message
          : `Something went wrong sending that. Try again, or email ${org.email}.`,
      );
    }
  };

  const alert = message && (
    <p
      role="alert"
      className="label mt-5 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
    >
      {message}
    </p>
  );

  if (step.k === "camera") {
    return (
      <IdCamera
        onCapture={(blob) => goTo({ k: "redact", source: blob })}
        onCancel={() => goTo({ k: "source" })}
      />
    );
  }

  if (step.k === "redact") {
    const source = step.source;
    return (
      <IdRedactor
        source={source}
        onDone={(blob) => redacted(source, blob)}
        onBack={() => goTo({ k: "source" })}
      />
    );
  }

  if (step.k === "source") {
    return (
      <>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          Take the photo here, or send one you already have. Either way you
          get to black parts of it out before it goes anywhere.
        </p>

        {alert}

        <div className="mt-7 flex flex-col gap-3">
          <button onClick={() => goTo({ k: "camera" })} className={btnGo}>
            Take a photo
          </button>
          {/* A label around the input rather than a button that clicks it, so
              the picker opens with no script on the path and the input stays
              in the tab order. No capture attribute: a phone offers its own
              chooser, with the camera roll in it, and a desktop gets a file
              picker. */}
          <label className={`${btnGo} cursor-pointer`}>
            Upload a photo
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                choose(e.target.files?.[0] ?? null);
                // Cleared so choosing the same file after a Back fires again.
                e.target.value = "";
              }}
            />
          </label>
          <button onClick={onBack} className={btn}>
            Back
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        Check your photo, your name and your date of birth are still readable,
        then type the date of birth as it is on the card. A person reads every
        one of these, so it takes a while - you&rsquo;ll hear from {org.email}{" "}
        before the next date.
      </p>

      <div className="mt-7 flex flex-col gap-5">
        {preview && (
          <figure className="border border-line bg-ink p-2">
            {/* A blob URL, so next/image is no use here even before the static
                export rules it out. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Your ID with your blackouts on it, before sending it"
              className="max-h-[46vh] w-full object-contain"
            />
            <figcaption className="label mt-2 flex items-center justify-between gap-3 text-silverfaint">
              <span>{megabytes(step.redacted.size)} · WHAT THE REVIEWER WILL SEE</span>
              <button
                type="button"
                // The already-redacted image, not the raw one: re-entering
                // the blackout screen must build on the blackouts already
                // drawn, never hand the guest's own screen the raw photo
                // back after they have already painted over part of it.
                onClick={() => goTo({ k: "redact", source: step.redacted })}
                disabled={busy || sent}
                className="label min-h-11 shrink-0 text-chalk underline decoration-line underline-offset-4 transition-colors hover:text-bloodhi hover:decoration-bloodhi disabled:opacity-50"
              >
                EDIT THE BLACKOUTS
              </button>
            </figcaption>
          </figure>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="id-kind" className="label text-silverfaint">
            WHAT IS IT
          </label>
          <select
            id="id-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={busy || sent}
            className={`${field} w-full [color-scheme:dark]`}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="id-dob" className="label text-silverfaint">
            DATE OF BIRTH
          </label>
          <input
            id="id-dob"
            type="date"
            value={dob}
            onChange={(e) => {
              setDob(e.target.value);
              if (phase === "error") {
                setPhase("idle");
                setMessage(null);
              }
            }}
            disabled={busy || sent}
            className={`${field} w-full [color-scheme:dark]`}
          />
          {underage && (
            <p className="label leading-loose text-bloodhi">
              THAT MAKES YOU {age}. OUR NIGHTS ARE {MIN_AGE}+.
            </p>
          )}
          {futureDob && (
            <p className="label leading-loose text-bloodhi">
              THAT DATE IS IN THE FUTURE.
            </p>
          )}
        </div>
      </div>

      {alert}

      <div className="mt-7 flex flex-col gap-3">
        <button
          onClick={submit}
          disabled={busy || sent || !dob || underage || futureDob}
          className={btnGo}
        >
          {busy ? "Sending…" : sent ? "Sent" : "Send for review"}
        </button>
        <button
          onClick={() => goTo({ k: "source" })}
          disabled={busy || sent}
          className={btn}
        >
          Back
        </button>
      </div>
    </>
  );
}
