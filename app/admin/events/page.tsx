"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  deleteEvent,
  listEvents,
  upsertEvent,
  type EventRow,
} from "@/lib/admin-data";
import { siteImageUrl } from "@/lib/site-content";
import EventPhotoPicker from "@/components/EventPhotoPicker";
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
 *
 * On a desk the form and the list sit side by side, which is what makes the
 * edit button worth pressing - the row and the fields it fills are in view at
 * once. On a phone they stack, form first, and editing scrolls back up to it.
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
  blurb: string;
  ticketRedirectUrl: string;
  /** Paths in the site-images bucket, in the order they will be shown. */
  photoPaths: string[];
  published: boolean;
};

/**
 * A new date starts published.
 *
 * It used to start as a draft, which meant the button marked "Post event"
 * posted something nobody could see - the row appeared in the list here and
 * never on the site, with nothing on either screen saying why. Anyone who
 * genuinely wants to hold one back can untick the box; that is a deliberate
 * act, and it is the rarer one.
 */
const EMPTY: Draft = {
  slug: "",
  title: "",
  date: "",
  time: "",
  blurb: "",
  ticketRedirectUrl: "",
  photoPaths: [],
  published: true,
};

type Listing =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "ready"; rows: EventRow[] };

const rowBtn =
  "label min-h-9 border border-line px-3 tracking-[0.11em] text-silverdim uppercase transition-colors hover:border-linehi hover:bg-ink2 hover:text-chalk disabled:cursor-not-allowed disabled:opacity-50";
const rowBtnDanger =
  "label min-h-9 border border-[rgba(200,16,46,0.45)] px-3 tracking-[0.11em] text-bloodhi uppercase transition-colors hover:border-bloodhi disabled:cursor-not-allowed disabled:opacity-50";

/** The small grey caption under a field. */
const hint = "mt-2 text-[0.8125rem] leading-relaxed text-silverfaint";

/**
 * The head of a panel. Deliberately the same shape, padding and type as the
 * one in app/admin/page.tsx - a page file may only export its page, so the two
 * cannot share an import, but moving between the dashboard and this editor
 * should not feel like moving between two different tools.
 */
function PanelHead({
  title,
  sub,
  count,
  right,
}: {
  title: string;
  sub?: string;
  count?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <p className="label flex items-center gap-2 tracking-[0.11em] text-silverdim uppercase">
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-ink2 px-2 py-0.5 text-silver tabular-nums">
              {count}
            </span>
          )}
        </p>
        {sub && (
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-silverfaint">
            {sub}
          </p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/**
 * A labelled group of fields, so the form reads as four decisions not nine.
 *
 * A plain div rather than fieldset/legend on purpose. A fieldset carries
 * `min-inline-size: min-content` in the UA stylesheet, which a flex column of
 * inputs inside it cannot shrink past - the group ends up as wide as its widest
 * unbreakable child and spills out of the panel.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-linesoft pt-5 first:border-t-0 first:pt-0">
      <h2 className="label mb-3 tracking-[0.11em] text-silverdim uppercase">
        {label}
      </h2>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

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
      ? "Needed"
      : SLUG_OK.test(slug)
        ? null
        : "Lowercase letters, numbers and hyphens only",
    title: title ? null : "Needed",
    date: draft.date ? null : "Needed",
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
      blurb: row.blurb ?? "",
      ticketRedirectUrl: row.ticketRedirectUrl ?? "",
      photoPaths: row.photoPaths ?? [],
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

    const blurb = draft.blurb.trim();
    const time = draft.time.trim();
    const ticketRedirectUrl = draft.ticketRedirectUrl.trim();

    const payload: Parameters<typeof upsertEvent>[0] = {
      slug,
      title,
      date: draft.date,
      dow: dowOf(draft.date),
      // Nullable columns, so an emptied field means "clear this".
      blurb: blurb || null,
      ticketRedirectUrl: ticketRedirectUrl || null,
      photoPaths: draft.photoPaths,
      published: draft.published,
    };
    // The time cannot hold an empty string - it is NOT NULL with a default in
    // 0002 - so leaving it out lets the default stand on an insert and the
    // stored value stand on an edit.
    if (time) payload.time = time;

    const out = await upsertEvent(payload);
    if (!alive.current) return;
    setSaving(false);

    if (!out.ok) {
      setNotice({ bad: true, text: out.error ?? "That did not save." });
      return;
    }
    setNotice({ bad: false, text: `Saved ${slug}.` });
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
      setNotice({ bad: true, text: out.error ?? "That did not delete." });
      return;
    }
    setNotice({ bad: false, text: `Deleted ${target}.` });
    if (editing === target) reset();
    void load();
  };

  if (!ready) {
    return (
      <main className="mx-auto w-[92vw] max-w-[560px] py-[clamp(3rem,10vw,6rem)]">
        <p className="label text-silverfaint uppercase">Checking access…</p>
      </main>
    );
  }

  if (!user || !isAdmin) {
    return (
      <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(3rem,10vw,6rem)]">
        <span className="label border border-line px-3 py-2 tracking-[0.11em] text-silverfaint uppercase">
          Staff only
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Events
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {user
            ? "You are signed in, but this account is not an admin."
            : "Sign in with an admin account to post or edit dates."}
        </p>
        {authError && <p className={hint}>{authError}</p>}
        <Link href="/login" className={`${btnGo} mt-7 w-full`}>
          Sign in
        </Link>
        <Link
          href="/admin"
          className="label mt-6 block tracking-[0.11em] text-silverfaint uppercase transition-colors hover:text-chalk"
        >
          &larr; Back to admin
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-[92vw] max-w-[1320px] pb-[clamp(2rem,6vw,3.5rem)]">
      {/* ------------------------------------------------------- app bar -- */}
      <header className="sticky top-0 z-30 -mx-[4vw] mb-4 border-b border-line bg-void/90 px-[4vw] py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="label flex min-h-9 shrink-0 items-center gap-1.5 tracking-[0.11em] text-silverfaint uppercase transition-colors hover:text-chalk"
          >
            <span aria-hidden>&larr;</span> Admin
          </Link>
          <span className="hidden h-4 w-px shrink-0 bg-line sm:block" />
          <span className="font-display truncate text-[1.0625rem] leading-none tracking-[0.06em] text-chalk uppercase">
            Events
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-5">
        {/* --------------------------------------------------------- form -- */}
        <section className="border border-line bg-ink">
          <PanelHead
            title={editing ? "Editing" : "New event"}
            sub={editing ?? "Nothing here shows up until you publish it."}
          />

          <form
            ref={formRef}
            onSubmit={save}
            className="flex flex-col gap-6 px-5 py-5"
          >
            <Group label="Basics">
              <div>
                <label htmlFor="title" className="label text-silverfaint uppercase">
                  Title
                </label>
                <input
                  id="title"
                  value={draft.title}
                  onChange={(e) => set("title", e.target.value)}
                  aria-invalid={Boolean(shown("title"))}
                  placeholder="WECAMETOOHALLOWEEN"
                  className={`${field} mt-2 w-full`}
                />
                {shown("title") && (
                  <p className="mt-2 text-[0.8125rem] text-bloodhi" role="alert">
                    {shown("title")}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="slug" className="label text-silverfaint uppercase">
                  Web address
                </label>
                <div className="mt-2 flex items-center">
                  <span className="label flex min-h-11 shrink-0 items-center border border-r-0 border-line bg-[#0a0b0d] px-3 text-silverfaint">
                    /events/
                  </span>
                  <input
                    id="slug"
                    value={draft.slug}
                    onChange={(e) => set("slug", e.target.value)}
                    // The slug is the primary key, so changing it on an edit
                    // would insert a second event rather than rename the first.
                    readOnly={editing !== null}
                    aria-invalid={Boolean(shown("slug"))}
                    placeholder="wecametoohalloween"
                    className={`${field} w-full min-w-0 ${editing ? "text-silverdim" : ""}`}
                  />
                </div>
                {shown("slug") ? (
                  <p className="mt-2 text-[0.8125rem] text-bloodhi" role="alert">
                    {shown("slug")}
                  </p>
                ) : (
                  editing && <p className={hint}>Fixed once posted.</p>
                )}
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label htmlFor="date" className="label text-silverfaint uppercase">
                    Date
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
                    <p className="mt-2 text-[0.8125rem] text-bloodhi" role="alert">
                      {shown("date")}
                    </p>
                  )}
                </div>
                <div className="w-[6.5rem]">
                  <span className="label text-silverfaint uppercase">Day</span>
                  <p className="label mt-2 flex min-h-11 items-center border border-line px-3.5 text-chalk">
                    {dowOf(draft.date) || "—"}
                  </p>
                </div>
              </div>

              <div>
                <label htmlFor="time" className="label text-silverfaint uppercase">
                  Time
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
                <label htmlFor="blurb" className="label text-silverfaint uppercase">
                  Blurb
                </label>
                <textarea
                  id="blurb"
                  value={draft.blurb}
                  onChange={(e) => set("blurb", e.target.value)}
                  rows={3}
                  placeholder="Dress code, who's playing, anything worth knowing."
                  className={`${field} mt-2 w-full resize-y`}
                />
                <p className={hint}>Never the address — that goes out by email.</p>
              </div>
            </Group>

            <Group label="Photos">
              <EventPhotoPicker
                paths={draft.photoPaths}
                onChange={(next) => set("photoPaths", next)}
                disabled={saving}
              />
            </Group>

            <Group label="Tickets">
              <div>
                <label
                  htmlFor="ticketRedirectUrl"
                  className="label text-silverfaint uppercase"
                >
                  Sell somewhere else
                </label>
                <input
                  id="ticketRedirectUrl"
                  value={draft.ticketRedirectUrl}
                  onChange={(e) => set("ticketRedirectUrl", e.target.value)}
                  inputMode="url"
                  placeholder="https://posh.vip/e/…"
                  className={`${field} mt-2 w-full`}
                />
                <p className={hint}>
                  {draft.ticketRedirectUrl.trim()
                    ? "The event page will send people here instead of selling."
                    : "Leave empty to sell on the site."}
                </p>
              </div>
            </Group>

            <Group label="Publish">
              <div>
                <label
                  htmlFor="published"
                  className="label flex min-h-11 cursor-pointer items-center gap-3 border border-line px-3.5 text-chalk uppercase"
                >
                  <input
                    id="published"
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => set("published", e.target.checked)}
                    className="h-4 w-4 accent-blood"
                  />
                  Published
                </label>
                <p className={hint}>
                  {draft.published
                    ? "Live on the site as soon as you save."
                    : "Saved as a draft — it will not appear on the site."}
                </p>
              </div>
            </Group>

            {notice && (
              <p
                className={`border px-3 py-2.5 text-[0.875rem] leading-relaxed ${
                  notice.bad
                    ? "border-[rgba(200,16,46,0.45)] bg-[rgba(200,16,46,0.06)] text-bloodhi"
                    : "border-line text-silverdim"
                }`}
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
        </section>

        {/* --------------------------------------------------------- list -- */}
        <section className="border border-line bg-ink">
          <PanelHead
            title="Posted"
            count={listing.kind === "ready" ? listing.rows.length : "—"}
            sub="Only dates posted from here. The ones built into the site are separate."
          />

          {/* Still reading, nothing there and could not read are three
              different sentences in three different frames. A promoter who
              takes a failed read for an empty list posts the same date twice. */}
          {listing.kind === "loading" && (
            <div className="px-5 py-5">
              <p className="label flex animate-pulse items-center gap-2 text-silverfaint uppercase">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-silverfaint" />
                Loading…
              </p>
            </div>
          )}

          {listing.kind === "error" && (
            <div
              className="m-5 border border-[rgba(200,16,46,0.45)] bg-[rgba(200,16,46,0.06)] p-4"
              role="alert"
            >
              <p className="label tracking-[0.11em] text-bloodhi uppercase">
                Nothing loaded
              </p>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-bloodhi">
                {listing.text}
              </p>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-silverdim">
                Not an empty list — nothing was read at all.
              </p>
              <button onClick={() => void load()} className={`${btn} mt-4`}>
                Try again
              </button>
            </div>
          )}

          {listing.kind === "ready" && listing.rows.length === 0 && (
            <div className="px-5 py-5">
              <div className="border border-dashed border-line px-4 py-6 text-center">
                <p className="text-[0.9375rem] leading-relaxed text-silverdim">
                  No dates posted yet. The form writes the first one.
                </p>
              </div>
            </div>
          )}

          {listing.kind === "ready" && listing.rows.length > 0 && (
            <ul>
              {listing.rows.map((row) => {
                const thumb =
                  siteImageUrl(row.photoPaths?.[0] ?? null) ?? row.flyerUrl;
                return (
                  <li
                    key={row.slug}
                    className="flex gap-4 border-t border-linesoft px-5 py-4 transition-colors hover:bg-ink2/40"
                  >
                    <div className="aspect-[3/4] w-14 shrink-0 overflow-hidden border border-line bg-ink2">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="hairline-x h-full w-full" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="font-display min-w-0 text-[1.05rem] break-words text-chalk">
                          {row.title}
                        </span>
                        <div className="flex shrink-0 gap-1.5">
                          {row.ticketRedirectUrl && (
                            <span
                              className="label border border-line px-1.5 py-0.5 text-silverfaint"
                              title={row.ticketRedirectUrl}
                            >
                              OFF-SITE
                            </span>
                          )}
                          {!row.published && (
                            <span className="label border border-line px-1.5 py-0.5 text-silverfaint">
                              DRAFT
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="label mt-1.5 text-silverdim">
                        {row.dow || dowOf(row.date)} {dayOf(row.date)}{" "}
                        {monthOf(row.date)} · {row.time}
                      </p>
                      <p className="label mt-1 break-all text-silverfaint">
                        /{row.slug}
                        {row.photoPaths?.length
                          ? ` · ${row.photoPaths.length} photo${row.photoPaths.length === 1 ? "" : "s"}`
                          : ""}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => edit(row)}
                          disabled={busySlug === row.slug}
                          className={rowBtn}
                        >
                          Edit
                        </button>
                        {confirming === row.slug ? (
                          <>
                            <button
                              onClick={() => void remove(row.slug)}
                              disabled={busySlug === row.slug}
                              className={rowBtnDanger}
                            >
                              Delete for good
                            </button>
                            <button
                              onClick={() => setConfirming(null)}
                              className={rowBtn}
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirming(row.slug)}
                            disabled={busySlug === row.slug}
                            className={rowBtn}
                          >
                            {busySlug === row.slug ? "Deleting…" : "Delete"}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
