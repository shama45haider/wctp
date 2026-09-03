"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  deleteEvent,
  listEvents,
  upsertEvent,
  type EventRow,
} from "@/lib/admin-data";
import { btn, btnGo, field } from "@/lib/ui";
import { dayOf, monthOf } from "@/lib/events";

/**
 * Posting and editing the dates.
 *
 * Rows written here land in public.events and show up on the site once
 * published; lib/events.ts still holds the ones compiled into the build. The
 * gate is the same one the dashboard uses and it decides nothing on its own -
 * row-level security refuses the write regardless, and upsertEvent reports the
 * refusal as an error rather than a silent success.
 */

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * The three letters over a date, worked out rather than asked for.
 *
 * Parsed field by field into a local date. `new Date("2026-09-04")` is read as
 * UTC midnight, which is still the 3rd anywhere west of Greenwich - the flyer
 * would say THU for a Friday party for every guest in New York.
 */
function dowOf(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DOW[new Date(y, m - 1, d).getDay()];
}

const SLUG_OK = /^[a-z0-9-]+$/;

type Draft = {
  slug: string;
  title: string;
  date: string;
  time: string;
  venue: string;
  flyerUrl: string;
  blurb: string;
  published: boolean;
};

const EMPTY: Draft = {
  slug: "",
  title: "",
  date: "",
  time: "",
  venue: "",
  flyerUrl: "",
  blurb: "",
  published: false,
};

type Listing =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "ready"; rows: EventRow[] };

const rowBtn =
  "label min-h-11 border border-line px-3 text-silverdim transition-colors hover:border-silverdim hover:text-chalk disabled:cursor-not-allowed disabled:opacity-50";
const rowBtnDanger =
  "label min-h-11 border border-[rgba(200,16,46,0.5)] px-3 text-bloodhi transition-colors hover:border-bloodhi disabled:cursor-not-allowed disabled:opacity-50";

export default function AdminEvents() {
  const { ready, user, isAdmin, error: authError } = useSupabaseAuth();

  const [listing, setListing] = useState<Listing>({ kind: "loading" });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ bad: boolean; text: string } | null>(
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setListing({ kind: "loading" });
    const { rows, error } = await listEvents();
    if (!alive.current) return;
    setListing(error ? { kind: "error", text: error } : { kind: "ready", rows });
  }, []);

  // Only after the gate has opened. Asking as a guest returns an empty list
  // that reads exactly like "no events", which is a different thing.
  useEffect(() => {
    if (ready && isAdmin) void load();
  }, [ready, isAdmin, load]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const slug = draft.slug.trim();
  const title = draft.title.trim();
  const problems = {
    slug: !slug
      ? "REQUIRED"
      : SLUG_OK.test(slug)
        ? null
        : "LOWERCASE LETTERS, DIGITS AND HYPHENS ONLY",
    title: title ? null : "REQUIRED",
    date: draft.date ? null : "REQUIRED",
  };
  const blocked = Boolean(problems.slug || problems.title || problems.date);

  // Required-field complaints wait for a submit; a malformed slug does not,
  // since the shape of it is not obvious until something objects.
  const shown = (key: keyof typeof problems) =>
    attempted || (key === "slug" && slug !== "") ? problems[key] : null;

  const reset = () => {
    setDraft(EMPTY);
    setEditing(null);
    setAttempted(false);
  };

  const edit = (row: EventRow) => {
    setDraft({
      slug: row.slug,
      title: row.title,
      date: row.date,
      time: row.time,
      venue: row.venue,
      flyerUrl: row.flyerUrl ?? "",
      blurb: row.blurb ?? "",
      published: row.published,
    });
    setEditing(row.slug);
    setAttempted(false);
    setNotice(null);
    setConfirming(null);
    // The list can run long past the form on a phone.
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (blocked || saving) return;

    setSaving(true);
    setNotice(null);

    const flyerUrl = draft.flyerUrl.trim();
    const blurb = draft.blurb.trim();
    const time = draft.time.trim();
    const venue = draft.venue.trim();

    const payload: Parameters<typeof upsertEvent>[0] = {
      slug,
      title,
      date: draft.date,
      dow: dowOf(draft.date),
      // Nullable columns, so an emptied field means "clear this".
      flyerUrl: flyerUrl || null,
      blurb: blurb || null,
      published: draft.published,
    };
    // These two cannot hold an empty string - they are NOT NULL with defaults
    // in 0002 - so leaving them out lets the default stand on an insert and the
    // stored value stand on an edit.
    if (time) payload.time = time;
    if (venue) payload.venue = venue;

    const out = await upsertEvent(payload);
    if (!alive.current) return;
    setSaving(false);

    if (!out.ok) {
      setNotice({ bad: true, text: out.error ?? "The save did not go through" });
      return;
    }
    setNotice({ bad: false, text: `SAVED ${slug}` });
    reset();
    void load();
  };

  const remove = async (target: string) => {
    setConfirming(null);
    setBusySlug(target);
    setNotice(null);

    const out = await deleteEvent(target);
    if (!alive.current) return;
    setBusySlug(null);

    if (!out.ok) {
      setNotice({
        bad: true,
        text: out.error ?? "The delete did not go through",
      });
      return;
    }
    setNotice({ bad: false, text: `DELETED ${target}` });
    if (editing === target) reset();
    void load();
  };

  if (!ready) {
    return (
      <main className="mx-auto w-[92vw] max-w-[560px] py-[clamp(3rem,10vw,6rem)]">
        <p className="label text-silverfaint">CHECKING ACCESS…</p>
      </main>
    );
  }

  if (!user || !isAdmin) {
    return (
      <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(3rem,10vw,6rem)]">
        <span className="label border border-line px-3 py-2 text-silverfaint">
          STAFF ONLY
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Events
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {user
            ? "This account is signed in but is not an admin."
            : "Sign in with an admin account to post or edit dates."}
        </p>
        {authError && (
          <p className="label mt-4 text-silverfaint">{authError}</p>
        )}
        <Link href="/login" className={`${btnGo} mt-7 w-full`}>
          Sign in
        </Link>
        <Link
          href="/admin"
          className="label mt-6 block text-silverfaint transition-colors hover:text-chalk"
        >
          &larr; BACK TO ADMIN
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-[92vw] max-w-[560px] py-[clamp(2.5rem,8vw,5rem)]">
      <span className="label border border-line px-3 py-2 text-silverfaint">
        {editing ? `EDITING ${editing}` : "NEW EVENT"}
      </span>

      <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
        Events
      </h1>
      <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
        Drafts stay invisible to guests until published. The dates built into
        the site are separate and are not listed here.
      </p>

      <form ref={formRef} onSubmit={save} className="mt-8 flex flex-col gap-5">
        <div>
          <label htmlFor="slug" className="label text-silverfaint">
            SLUG
          </label>
          <input
            id="slug"
            value={draft.slug}
            onChange={(e) => set("slug", e.target.value)}
            // A slug is the primary key, so an edit that changes it inserts a
            // second event rather than renaming the first.
            readOnly={editing !== null}
            aria-invalid={Boolean(shown("slug"))}
            placeholder="wecametoohalloween"
            className={`${field} mt-2 w-full ${
              editing ? "text-silverdim" : ""
            }`}
          />
          {shown("slug") ? (
            <p className="label mt-2 text-bloodhi" role="alert">
              {shown("slug")}
            </p>
          ) : (
            <p className="label mt-2 text-silverfaint">
              {editing
                ? "PERMANENT. DELETE AND REPOST TO CHANGE IT."
                : "THE ADDRESS: /EVENTS/YOUR-SLUG"}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="title" className="label text-silverfaint">
            TITLE
          </label>
          <input
            id="title"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            aria-invalid={Boolean(shown("title"))}
            className={`${field} mt-2 w-full`}
          />
          {shown("title") && (
            <p className="label mt-2 text-bloodhi" role="alert">
              {shown("title")}
            </p>
          )}
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="date" className="label text-silverfaint">
              DATE
            </label>
            <input
              id="date"
              type="date"
              value={draft.date}
              onChange={(e) => set("date", e.target.value)}
              aria-invalid={Boolean(shown("date"))}
              className={`${field} mt-2 w-full`}
            />
            {shown("date") && (
              <p className="label mt-2 text-bloodhi" role="alert">
                {shown("date")}
              </p>
            )}
          </div>
          <div className="w-[6.5rem]">
            <span className="label text-silverfaint">DAY</span>
            <p className="label mt-2 flex min-h-11 items-center border border-line px-3.5 text-chalk">
              {dowOf(draft.date) || "—"}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="time" className="label text-silverfaint">
            TIME
          </label>
          <input
            id="time"
            value={draft.time}
            onChange={(e) => set("time", e.target.value)}
            placeholder="9:00 PM"
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <label htmlFor="venue" className="label text-silverfaint">
            VENUE
          </label>
          <input
            id="venue"
            value={draft.venue}
            onChange={(e) => set("venue", e.target.value)}
            placeholder="Location TBA"
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <label htmlFor="flyer" className="label text-silverfaint">
            FLYER URL
          </label>
          <input
            id="flyer"
            value={draft.flyerUrl}
            onChange={(e) => set("flyerUrl", e.target.value)}
            inputMode="url"
            placeholder="https://…"
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <label htmlFor="blurb" className="label text-silverfaint">
            BLURB
          </label>
          <textarea
            id="blurb"
            value={draft.blurb}
            onChange={(e) => set("blurb", e.target.value)}
            rows={3}
            className={`${field} mt-2 w-full resize-y`}
          />
        </div>

        <label
          htmlFor="published"
          className="label flex min-h-11 cursor-pointer items-center gap-3 border border-line px-3.5 text-chalk"
        >
          <input
            id="published"
            type="checkbox"
            checked={draft.published}
            onChange={(e) => set("published", e.target.checked)}
            className="h-4 w-4 accent-blood"
          />
          PUBLISHED
        </label>

        {notice && (
          <p
            className={`label ${notice.bad ? "text-bloodhi" : "text-silverdim"}`}
            role={notice.bad ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving || (attempted && blocked)}
            className={`${btnGo} flex-1`}
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Post event"}
          </button>
          {editing && (
            <button type="button" onClick={reset} className={btn}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <h2 className="label mt-12 border-y border-line py-3 text-silverfaint">
        POSTED EVENTS
      </h2>

      {listing.kind === "loading" && (
        <p className="label mt-5 text-silverfaint">LOADING EVENTS…</p>
      )}

      {listing.kind === "error" && (
        <div className="mt-5">
          <p className="label text-bloodhi" role="alert">
            {listing.text}
          </p>
          <button onClick={() => void load()} className={`${btn} mt-4`}>
            Try again
          </button>
        </div>
      )}

      {listing.kind === "ready" && listing.rows.length === 0 && (
        <p className="label mt-5 text-silverfaint">
          NOTHING POSTED YET. THE FORM ABOVE WRITES THE FIRST ONE.
        </p>
      )}

      {listing.kind === "ready" && listing.rows.length > 0 && (
        <ul className="mt-2">
          {listing.rows.map((row) => (
            <li key={row.slug} className="border-b border-line py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-display text-[1.05rem] break-words text-chalk">
                  {row.title}
                </span>
                {!row.published && (
                  <span className="label shrink-0 border border-line px-2 py-1 text-silverfaint">
                    DRAFT
                  </span>
                )}
              </div>

              <p className="label mt-2 text-silverdim">
                {row.dow || dowOf(row.date)} {dayOf(row.date)}{" "}
                {monthOf(row.date)} · {row.time} · {row.venue}
              </p>
              <p className="label mt-1 break-all text-silverfaint">
                /{row.slug}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => edit(row)}
                  disabled={busySlug === row.slug}
                  className={rowBtn}
                >
                  EDIT
                </button>
                {confirming === row.slug ? (
                  <>
                    <button
                      onClick={() => void remove(row.slug)}
                      disabled={busySlug === row.slug}
                      className={rowBtnDanger}
                    >
                      DELETE FOR GOOD
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className={rowBtn}
                    >
                      KEEP
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirming(row.slug)}
                    disabled={busySlug === row.slug}
                    className={rowBtn}
                  >
                    {busySlug === row.slug ? "DELETING…" : "DELETE"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/admin"
        className="label mt-10 block text-silverfaint transition-colors hover:text-chalk"
      >
        &larr; BACK TO ADMIN
      </Link>
    </main>
  );
}
