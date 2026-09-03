"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * The manual side of the age check: a photo of an ID and a date of birth, left
 * for a human to look at.
 *
 * This is the path for everyone the barcode reader cannot serve - a student ID
 * with no PDF417 on it, a passport, a phone with no working camera. It is
 * slower on purpose. Nothing here approves anybody; it files a row in the
 * queue that an admin later reads in app/admin, and the guest is told as much
 * rather than being shown a tick that means nothing.
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
  "Student ID",
  "College ID",
  "Passport",
  "State ID",
  "Other",
] as const;

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

/**
 * A filename the storage API will accept.
 *
 * Slashes are the reason this exists: a name carrying one would push the file
 * into a deeper folder, and the RLS policy in 0003 only looks at the first
 * segment, so the write would land somewhere nobody goes looking for it.
 * Spaces and the rest go for the sake of the signed URLs built from this path.
 */
function safeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9.]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    // Long enough to stay recognisable, short enough to stay under the key
    // limits, and taken from the end so the extension survives.
    .slice(-60);
  return cleaned || "id-document";
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
  onBack: () => void;
}) {
  const { ready, user } = useSupabaseAuth();

  const [file, setFile] = useState<File | null>(null);
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

  // A blob URL is held by the document until it is revoked, and the file
  // behind it with it. Choosing a photo, looking at it and choosing another is
  // the normal way this screen gets used, so each one is released as it is
  // replaced, and the last one on the way out.
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const swapFile = (next: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : null;
    setFile(next);
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
            ? "Sending an ID needs an account, so we know whose it is and where to write back."
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
  const done = phase === "submitted";

  const choose = (picked: File | null) => {
    setMessage(null);
    setPhase("idle");
    if (!picked) return swapFile(null);

    // Some phones hand over a HEIC with an empty type rather than image/heic,
    // so an empty type falls back to the extension instead of being refused.
    const looksLikeImage = picked.type
      ? picked.type.startsWith("image/")
      : /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(picked.name);

    if (!looksLikeImage) {
      swapFile(null);
      setPhase("error");
      setMessage(
        "That is not an image. Send a photo of the document - a PDF or a document file will not do.",
      );
      return;
    }

    if (picked.size > MAX_BYTES) {
      swapFile(null);
      setPhase("error");
      setMessage(
        `That photo is ${megabytes(picked.size)}, and the limit is ${megabytes(
          MAX_BYTES,
        )}. Take it again at a lower resolution, or send a smaller copy.`,
      );
      return;
    }

    swapFile(picked);
  };

  const submit = async () => {
    if (!file) {
      setPhase("error");
      return setMessage("Choose a photo of the document first.");
    }
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
    // otherwise reject as a duplicate.
    const path = `${user.id}/${Date.now()}-${safeFilename(file.name)}`;

    try {
      const up = await capped(
        supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type || undefined,
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
          }. Try again, or write to us and quote ${path}.`,
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
          : "Something went wrong sending that.",
      );
    }
  };

  if (done) {
    return (
      <>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          That&rsquo;s with us. Somebody will look at it by hand and you&rsquo;ll
          hear back before the next date - it is not instant, and nothing is
          approved automatically.
        </p>
        <div className="label mt-6 flex items-center justify-between border border-line px-3 py-3">
          <span className="text-silverfaint">ID STATUS</span>
          <span className="text-chalk">AWAITING REVIEW</span>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        Send a photo of your ID and the date of birth on it. A person reads
        every one of these, so it takes a while - you&rsquo;ll hear back before
        the next date.
      </p>

      <div className="mt-7 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="id-kind" className="label text-silverfaint">
            WHAT IS IT
          </label>
          <select
            id="id-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={busy}
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
            disabled={busy}
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

        <div className="flex flex-col gap-2">
          <label htmlFor="id-photo" className="label text-silverfaint">
            PHOTO OF THE DOCUMENT
          </label>
          <input
            id="id-photo"
            type="file"
            accept="image/*"
            // Tells a phone to offer its back camera first. Desktop browsers
            // ignore it and show the file picker, which is what they should.
            capture="environment"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            disabled={busy}
            className={`${field} label w-full text-silverdim file:mr-3 file:border file:border-linehi file:bg-ink2 file:px-3 file:py-1.5 file:text-chalk`}
          />
        </div>

        {file && preview && (
          <figure className="border border-line bg-ink p-2">
            {/* A blob URL, so next/image is no use here even before the static
                export rules it out. */}
            <img
              src={preview}
              alt="The document you chose, before sending it"
              className="max-h-[46vh] w-full object-contain"
            />
            <figcaption className="label mt-2 text-silverfaint">
              {megabytes(file.size)} · CHECK EVERY LINE IS READABLE BEFORE YOU
              SEND IT
            </figcaption>
          </figure>
        )}
      </div>

      {message && (
        <p
          role="alert"
          className="label mt-5 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
        >
          {message}
        </p>
      )}

      <div className="mt-7 flex flex-col gap-3">
        <button
          onClick={submit}
          disabled={busy || !file || !dob || underage || futureDob}
          className={btnGo}
        >
          {busy ? "Sending…" : "Send for review"}
        </button>
        <button onClick={onBack} disabled={busy} className={btn}>
          Back
        </button>
      </div>

    </>
  );
}
