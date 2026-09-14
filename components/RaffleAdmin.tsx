"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { btn, btnGo, field } from "@/lib/ui";
import { atHandle } from "@/lib/handle";
import { avatarUrl } from "@/lib/profile-data";
import {
  clearDraw,
  createRaffle,
  endLive,
  goLive,
  listDraws,
  listEntries,
  listRaffles,
  liveLink,
  readLiveSession,
  removeEntry,
  saveRaffle,
  type AdminDraw,
  type AdminEntrant,
  type LiveSession,
  type Raffle,
} from "@/lib/raffle";

/**
 * The dashboard's raffle tab: which raffle, what it says, who is in it, and
 * the one-hour live link.
 *
 * Every rule sits in the database (0015_raffle.sql, 0016_raffle_admin_live.sql)
 * and this file only asks and shows the answer. The spin buttons are not here:
 * they live on the live page itself, so the admin spins in front of the same
 * wheel everyone else is watching.
 *
 * The panel primitives below copy app/admin/page.tsx class for class. A page
 * file may only export its page, so they cannot be imported from there.
 */

type Load<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: T[] };

type SessionLoad =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; session: LiveSession | null };

const POLL_MS = 5000;
const MAX_PLACES = 50;

/* ------------------------------------------------------------ primitives -- */

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`border border-line bg-ink ${className}`}>{children}</section>;
}

function PanelHead({
  title,
  count,
  right,
}: {
  title: string;
  count?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <p className="label text-silverfaint">
        {title}
        {count !== undefined && <span className="ml-2 text-chalk">{count}</span>}
      </p>
      {right}
    </div>
  );
}

function PanelBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-line px-4 py-5">
      <p className="text-[0.9375rem] leading-relaxed text-silverdim">{children}</p>
    </div>
  );
}

function Waiting({ what }: { what: string }) {
  return (
    <p className="label flex animate-pulse items-center gap-2 text-silverfaint">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-silverfaint" />
      {what}
    </p>
  );
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="border border-[rgba(200,16,46,0.5)] bg-[rgba(200,16,46,0.06)] p-4" role="alert">
      <p className="label text-bloodhi">NOTHING LOADED - THIS IS AN ERROR</p>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-bloodhi">{message}</p>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-silverdim">
        Do not read this as an empty list. Nothing was read at all.
      </p>
      <button onClick={onRetry} className={`${btn} mt-4`}>
        Try again
      </button>
    </div>
  );
}

/** An action the database refused: its own words, in the same red as a failed load. */
function Refused({ message, className = "" }: { message: string; className?: string }) {
  return (
    <p
      className={`border border-[rgba(200,16,46,0.5)] bg-[rgba(200,16,46,0.06)] px-3 py-2.5 text-[0.9375rem] leading-relaxed text-bloodhi ${className}`}
      role="alert"
    >
      {message}
    </p>
  );
}

function Tag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`label inline-flex whitespace-nowrap border px-2 py-0.5 ${
        on ? "border-linehi text-chalk" : "border-line text-silverfaint"
      }`}
    >
      {children}
    </span>
  );
}

function Avatar({ path, name, size = "h-10 w-10" }: { path: string | null; name: string; size?: string }) {
  const pic = avatarUrl(path);
  return pic ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={pic} alt="" className={`${size} shrink-0 rounded-full border border-line object-cover`} />
  ) : (
    <span
      className={`label flex ${size} shrink-0 items-center justify-center rounded-full border border-line text-silverfaint`}
    >
      {name.replace(/^@+/, "")[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function Toggle({
  on,
  onChange,
  title,
  detail,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex min-h-16 w-full items-center justify-between gap-4 border px-4 py-3 text-left transition-colors ${
        on ? "border-linehi bg-ink2" : "border-line bg-void hover:border-linehi"
      }`}
    >
      <span className="min-w-0">
        <span className="font-display block text-[1.125rem] leading-tight tracking-[0.06em] text-chalk uppercase">
          {title}
        </span>
        <span className="mt-1 block text-[0.875rem] leading-snug text-silverdim">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span className={`label w-8 text-right ${on ? "text-chalk" : "text-silverfaint"}`}>
          {on ? "ON" : "OFF"}
        </span>
        <span
          aria-hidden
          className={`relative block h-7 w-12 rounded-full border transition-colors ${
            on ? "border-bloodhi bg-[rgba(200,16,46,0.35)]" : "border-linehi bg-ink"
          }`}
        >
          <span
            className={`absolute top-1/2 left-0.5 block h-5 w-5 -translate-y-1/2 rounded-full transition-transform ${
              on ? "translate-x-[1.25rem] bg-chalk" : "bg-silverfaint"
            }`}
          />
        </span>
      </span>
    </button>
  );
}

/** Small square control for the prize rows' move / remove. */
const iconBtn =
  "label flex min-h-11 min-w-11 items-center justify-center border border-line text-silverdim transition-colors hover:border-linehi hover:text-chalk disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-silverdim";

/** Quiet destructive control, same as the dashboard's reset / clear buttons. */
const dangerBtn =
  "label flex min-h-11 items-center justify-center border border-line px-3 text-silverdim transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi disabled:opacity-50";

function day(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function moment(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const placeName = (prizes: Raffle["prizes"], place: number) =>
  prizes[place - 1]?.place.trim() || `PLACE ${place}`;

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/* ------------------------------------------------------------------ tab -- */

export default function RaffleAdmin() {
  const alive = useAlive();
  const [list, setList] = useState<Load<Raffle>>({ kind: "loading" });
  /** A refresh that failed while the list was already on screen. */
  const [listNote, setListNote] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Each bump re-reads the list. A background reload keeps what is on screen,
  // so an open draft is never thrown away by a refresh that failed.
  const [reload, setReload] = useState({ n: 0, background: false });

  useEffect(() => {
    let live = true;
    void listRaffles().then(({ raffles, error }) => {
      if (!live) return;
      if (error) {
        if (reload.background) setListNote(error);
        else setList({ kind: "error", message: error });
        return;
      }
      setListNote(null);
      setList({ kind: "ready", rows: raffles });
    });
    return () => {
      live = false;
    };
  }, [reload]);

  const retry = () => {
    setList({ kind: "loading" });
    setReload((r) => ({ n: r.n + 1, background: false }));
  };

  // Stable, since both child sections hold on to it.
  const refresh = useCallback(async () => {
    setReload((r) => ({ n: r.n + 1, background: true }));
  }, []);

  const create = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setCreating(true);
    setCreateError(null);
    const out = await createRaffle(newTitle);
    if (!alive.current) return;
    if (!out.id) {
      setCreateError(out.error ?? "Nothing was created.");
      setCreating(false);
      return;
    }
    await refresh();
    setSelectedId(out.id);
    setNewTitle("");
    setAdding(false);
    setCreating(false);
  };

  const rows = list.kind === "ready" ? list.rows : [];
  // Newest first from the database, so the fallback is the newest raffle.
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const onSite = rows.filter((r) => r.visible);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* -------------------------------------------------------- picker -- */}
      <Panel>
        <PanelHead
          title="RAFFLES"
          count={list.kind === "ready" ? rows.length : "—"}
          right={
            list.kind === "ready" && !adding ? (
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setCreateError(null);
                }}
                className={btn}
              >
                New raffle
              </button>
            ) : undefined
          }
        />

        {adding && (
          <form onSubmit={(ev) => void create(ev)} className="border-b border-line p-4">
            <label className="label block text-silverfaint" htmlFor="raffle-new-title">
              NEW RAFFLE TITLE
            </label>
            <input
              id="raffle-new-title"
              value={newTitle}
              onChange={(ev) => setNewTitle(ev.target.value)}
              placeholder="e.g. Halloween raffle"
              autoFocus
              className={`${field} mt-2 w-full`}
            />
            <p className="label mt-2 leading-loose text-silverfaint">
              STARTS HIDDEN FROM THE SITE, WITH THREE EMPTY PLACES.
            </p>
            {createError && <Refused message={createError} className="mt-3" />}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="submit" disabled={creating} className={btnGo}>
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => {
                  setAdding(false);
                  setNewTitle("");
                  setCreateError(null);
                }}
                className={btn}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {list.kind === "loading" && (
          <PanelBody>
            <Waiting what="READING THE RAFFLES…" />
          </PanelBody>
        )}
        {list.kind === "error" && (
          <PanelBody>
            <Failed message={list.message} onRetry={retry} />
          </PanelBody>
        )}
        {list.kind === "ready" && rows.length === 0 && !adding && (
          <PanelBody>
            <Empty>No raffles yet. Start one with New raffle.</Empty>
          </PanelBody>
        )}
        {list.kind === "ready" && rows.length > 0 && (
          <ul>
            {rows.map((r) => {
              const current = selected?.id === r.id;
              return (
                <li key={r.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    aria-current={current ? "true" : undefined}
                    className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-l-2 px-4 py-3 text-left transition-colors ${
                      current
                        ? "border-l-bloodhi bg-ink2"
                        : "border-l-transparent hover:bg-ink2"
                    }`}
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-[0.9375rem] ${current ? "text-chalk" : "text-silver"}`}
                      >
                        {r.title}
                      </span>
                      <span className="label block text-silverfaint">STARTED {day(r.createdAt)}</span>
                    </span>
                    <span className="flex shrink-0 flex-wrap gap-1.5">
                      <Tag on={r.visible}>{r.visible ? "ON SITE" : "HIDDEN"}</Tag>
                      <Tag on={r.open}>{r.open ? "OPEN" : "CLOSED"}</Tag>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {onSite.length > 1 && (
          <p className="label border-t border-line px-4 py-3 leading-loose text-silverfaint">
            {onSite.length} RAFFLES ARE SET TO SHOW ON THE SITE. THE POP-UP ONLY SHOWS THE NEWEST OF
            THEM: <span className="text-chalk">{onSite[0].title}</span>
          </p>
        )}
        {listNote && (
          <p className="label border-t border-line px-4 py-3 leading-loose text-bloodhi" role="alert">
            THE LIST DID NOT REFRESH - {listNote}
          </p>
        )}
      </Panel>

      {selected && (
        <>
          <RaffleDetails key={selected.id} raffle={selected} onSaved={refresh} />
          <RaffleActivity key={`activity-${selected.id}`} raffle={selected} onChanged={refresh} />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- details -- */

type PrizeRow = { key: number; place: string; items: string };

const toRows = (raffle: Raffle): PrizeRow[] =>
  raffle.prizes.map((p, i) => ({ key: i, place: p.place, items: p.items.join("\n") }));

const itemsOf = (text: string) =>
  text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

function RaffleDetails({ raffle, onSaved }: { raffle: Raffle; onSaved: () => Promise<void> }) {
  const alive = useAlive();
  const [title, setTitle] = useState(raffle.title);
  const [blurb, setBlurb] = useState(raffle.blurb ?? "");
  const [prizes, setPrizes] = useState<PrizeRow[]>(() => toRows(raffle));
  const [open, setOpen] = useState(raffle.open);
  const [visible, setVisible] = useState(raffle.visible);
  const nextKey = useRef(raffle.prizes.length);

  type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Going live closes entries from another panel. Follow the database when a
  // switch changes underneath the draft, without discarding typed text.
  const [seen, setSeen] = useState({ open: raffle.open, visible: raffle.visible });
  if (seen.open !== raffle.open || seen.visible !== raffle.visible) {
    setSeen({ open: raffle.open, visible: raffle.visible });
    if (seen.open !== raffle.open) setOpen(raffle.open);
    if (seen.visible !== raffle.visible) setVisible(raffle.visible);
  }

  const edited = () => setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));

  const editPrize = (key: number, patch: Partial<PrizeRow>) => {
    setPrizes((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    edited();
  };

  const move = (index: number, by: -1 | 1) => {
    setPrizes((ps) => {
      const to = index + by;
      if (to < 0 || to >= ps.length) return ps;
      const next = [...ps];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
    edited();
  };

  const addPlace = () => {
    const key = nextKey.current++;
    setPrizes((ps) => (ps.length >= MAX_PLACES ? ps : [...ps, { key, place: "", items: "" }]));
    edited();
  };

  const removePlace = (key: number) => {
    setPrizes((ps) => ps.filter((p) => p.key !== key));
    edited();
  };

  const cleanPrizes = prizes.map((p) => ({ place: p.place.trim(), items: itemsOf(p.items) }));
  const savedPrizes = raffle.prizes.map((p) => ({
    place: p.place.trim(),
    items: p.items.map((i) => i.trim()).filter(Boolean),
  }));
  const dirty =
    (title.trim() || "Raffle") !== raffle.title ||
    blurb.trim() !== (raffle.blurb ?? "").trim() ||
    JSON.stringify(cleanPrizes) !== JSON.stringify(savedPrizes) ||
    open !== raffle.open ||
    visible !== raffle.visible;

  const save = async () => {
    setStatus({ kind: "saving" });
    const out = await saveRaffle(raffle.id, {
      title,
      blurb,
      prizes: cleanPrizes,
      open,
      visible,
    });
    if (!alive.current) return;
    if (!out.ok) {
      setStatus({ kind: "error", message: out.error ?? "Nothing was saved." });
      return;
    }
    // Match what the database now holds, so "unsaved" clears once it reloads.
    setTitle((t) => t.trim() || "Raffle");
    setBlurb((b) => b.trim());
    await onSaved();
    if (!alive.current) return;
    setStatus({ kind: "saved" });
  };

  const saving = status.kind === "saving";

  return (
    <Panel>
      <PanelHead
        title="DETAILS"
        right={
          <span className="flex flex-wrap gap-1.5">
            <Tag on={raffle.visible}>{raffle.visible ? "ON SITE" : "HIDDEN"}</Tag>
            <Tag on={raffle.open}>{raffle.open ? "OPEN" : "CLOSED"}</Tag>
          </span>
        }
      />
      <PanelBody className="flex flex-col gap-5">
        <div>
          <label className="label block text-silverfaint" htmlFor="raffle-title">
            TITLE
          </label>
          <input
            id="raffle-title"
            value={title}
            onChange={(ev) => {
              setTitle(ev.target.value);
              edited();
            }}
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <label className="label block text-silverfaint" htmlFor="raffle-blurb">
            DESCRIPTION
          </label>
          <textarea
            id="raffle-blurb"
            value={blurb}
            onChange={(ev) => {
              setBlurb(ev.target.value);
              edited();
            }}
            rows={3}
            placeholder="Shown under the title in the pop-up"
            className={`${field} mt-2 block w-full resize-y leading-relaxed`}
          />
        </div>

        {/* ---------------------------------------------------- prizes -- */}
        <div>
          <p className="label text-silverfaint">
            PRIZES <span className="ml-2 text-chalk">{prizes.length}</span>
          </p>
          <p className="label mt-1 leading-loose text-silverfaint">
            PLACES ARE NUMBERED TOP TO BOTTOM. A WINNER STAYS WITH ITS NUMBER, SO REORDER BEFORE THE DRAW.
          </p>

          {prizes.length === 0 ? (
            <div className="mt-3">
              <Empty>No places yet. Add one below - nothing can be drawn without them.</Empty>
            </div>
          ) : (
            <ol className="mt-3 flex flex-col gap-3">
              {prizes.map((p, i) => (
                <li key={p.key} className="border border-line bg-void p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="label text-silverfaint">
                      PLACE <span className="text-chalk">{i + 1}</span>
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={`Move place ${i + 1} up`}
                        className={iconBtn}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === prizes.length - 1}
                        aria-label={`Move place ${i + 1} down`}
                        className={iconBtn}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removePlace(p.key)}
                        aria-label={`Remove place ${i + 1}`}
                        className={`${dangerBtn} min-w-11`}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <label className="label mt-3 block text-silverfaint" htmlFor={`prize-place-${p.key}`}>
                    LABEL
                  </label>
                  <input
                    id={`prize-place-${p.key}`}
                    value={p.place}
                    onChange={(ev) => editPrize(p.key, { place: ev.target.value })}
                    placeholder={`e.g. ${["1ST", "2ND", "3RD"][i] ?? `${i + 1}TH`} PLACE`}
                    className={`${field} mt-2 w-full`}
                  />
                  <label className="label mt-3 block text-silverfaint" htmlFor={`prize-items-${p.key}`}>
                    ITEMS - ONE PER LINE
                  </label>
                  <textarea
                    id={`prize-items-${p.key}`}
                    value={p.items}
                    onChange={(ev) => editPrize(p.key, { items: ev.target.value })}
                    rows={3}
                    className={`${field} mt-2 block w-full resize-y leading-relaxed`}
                  />
                </li>
              ))}
            </ol>
          )}

          <button
            type="button"
            onClick={addPlace}
            disabled={prizes.length >= MAX_PLACES}
            className={`${btn} mt-3 w-full`}
          >
            Add a place
          </button>
        </div>

        {/* -------------------------------------------------- switches -- */}
        <div className="flex flex-col gap-2">
          <Toggle
            on={visible}
            onChange={(v) => {
              setVisible(v);
              edited();
            }}
            title="Show on site"
            detail="The pop-up shows the newest raffle that is on. Off keeps it a draft only admins see."
          />
          <Toggle
            on={open}
            onChange={(v) => {
              setOpen(v);
              edited();
            }}
            title="Taking entries"
            detail="Verified members can enter. Needs Show on site too. Going live turns this off."
          />
        </div>

        {/* ------------------------------------------------------ save -- */}
        <div className="border-t border-line pt-4">
          {status.kind === "error" && <Refused message={status.message} className="mb-3" />}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              className={`${btnGo} w-full sm:w-auto`}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <p className="label text-silverfaint" aria-live="polite">
              {saving ? (
                <span className="animate-pulse">SAVING…</span>
              ) : status.kind === "saved" && !dirty ? (
                <span className="text-chalk">SAVED</span>
              ) : dirty ? (
                "UNSAVED CHANGES"
              ) : (
                "NO CHANGES"
              )}
            </p>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}

/* ------------------------------------------------- entries and live draw -- */

function RaffleActivity({ raffle, onChanged }: { raffle: Raffle; onChanged: () => Promise<void> }) {
  const alive = useAlive();
  const raffleId = raffle.id;

  const [entries, setEntries] = useState<Load<AdminEntrant>>({ kind: "loading" });
  const [session, setSession] = useState<SessionLoad>({ kind: "loading" });
  const [draws, setDraws] = useState<Load<AdminDraw>>({ kind: "loading" });
  const [stale, setStale] = useState<string | null>(null);
  const [reread, setReread] = useState(0);

  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ userId: string; message: string } | null>(null);
  const [liveBusy, setLiveBusy] = useState<"go" | "end" | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<number | null>(null);
  const [clearError, setClearError] = useState<{ place: number; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);

  const linkInput = useRef<HTMLInputElement>(null);
  // What was last read successfully, so a poll that fails keeps it on screen.
  const had = useRef({ entries: false, session: false, draws: false, live: false });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      const [e, s, d] = await Promise.all([
        listEntries(raffleId),
        readLiveSession(raffleId),
        listDraws(raffleId),
      ]);
      if (!live) return;
      const h = had.current;

      if (e.error && h.entries) {
        // keep the last good list
      } else if (e.error) {
        setEntries({ kind: "error", message: e.error });
      } else {
        h.entries = true;
        setEntries({ kind: "ready", rows: e.entries });
      }

      if (s.error && h.session) {
        // keep the last good session
      } else if (s.error) {
        setSession({ kind: "error", message: s.error });
      } else {
        h.session = true;
        h.live = s.session !== null;
        setSession({ kind: "ready", session: s.session });
      }

      if (d.error && h.draws) {
        // keep the last good winners
      } else if (d.error) {
        setDraws({ kind: "error", message: d.error });
      } else {
        h.draws = true;
        setDraws({ kind: "ready", rows: d.draws });
      }

      const kept = (e.error && h.entries) || (s.error && h.session) || (d.error && h.draws);
      setStale(kept ? (e.error ?? s.error ?? d.error ?? null) : null);

      if (h.live) timer = setTimeout(() => void read(), POLL_MS);
    };

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [raffleId, reread]);

  const expiresAt = session.kind === "ready" ? (session.session?.expiresAt ?? null) : null;

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [expiresAt]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const again = () => setReread((n) => n + 1);

  const retry = () => {
    had.current = { entries: false, session: false, draws: false, live: false };
    setEntries({ kind: "loading" });
    setSession({ kind: "loading" });
    setDraws({ kind: "loading" });
    setStale(null);
    again();
  };

  const byUser = new Map(entries.kind === "ready" ? entries.rows.map((e) => [e.userId, e]) : []);
  const drawRows = draws.kind === "ready" ? draws.rows : [];

  const remove = async (entrant: AdminEntrant) => {
    const who = atHandle(entrant.handle) || entrant.email || "this entrant";
    const won = drawRows.find((d) => d.userId === entrant.userId);
    const warning = won
      ? ` They are the drawn winner for ${placeName(raffle.prizes, won.place)} - clear that place to spin it again.`
      : "";
    if (!window.confirm(`Remove ${who} from "${raffle.title}"?${warning}`)) return;
    setRemoving(entrant.userId);
    setRemoveError(null);
    const out = await removeEntry(raffleId, entrant.userId);
    if (!alive.current) return;
    setRemoving(null);
    if (!out.ok) {
      setRemoveError({ userId: entrant.userId, message: out.error ?? "Nothing was removed." });
      return;
    }
    again();
  };

  const startLive = async () => {
    if (!window.confirm("This closes entries and creates a link that works for 1 hour.")) return;
    setLiveBusy("go");
    setLiveError(null);
    const out = await goLive(raffleId);
    if (!alive.current) return;
    setLiveBusy(null);
    if (!out.session) {
      setLiveError(out.error ?? "The live link didn't start.");
      return;
    }
    had.current.session = true;
    had.current.live = true;
    setSession({ kind: "ready", session: out.session });
    again();
    void onChanged();
  };

  const stopLive = async () => {
    if (!window.confirm("End the live link now? Anyone watching loses the wheel, and the link stops working.")) {
      return;
    }
    setLiveBusy("end");
    setLiveError(null);
    const out = await endLive(raffleId);
    if (!alive.current) return;
    setLiveBusy(null);
    if (!out.ok) {
      setLiveError(out.error ?? "The live link didn't end.");
      return;
    }
    had.current.live = false;
    setSession({ kind: "ready", session: null });
    again();
    void onChanged();
  };

  const clear = async (place: number) => {
    const name = placeName(raffle.prizes, place);
    if (!window.confirm(`Clear the winner for ${name}? That place can be spun again on the live page.`)) return;
    setClearing(place);
    setClearError(null);
    const out = await clearDraw(raffleId, place);
    if (!alive.current) return;
    setClearing(null);
    if (!out.ok) {
      setClearError({ place, message: out.error ?? "Nothing was cleared." });
      return;
    }
    again();
  };

  const copy = (link: string) => {
    const fallback = () => {
      linkInput.current?.focus();
      linkInput.current?.select();
    };
    if (!navigator.clipboard?.writeText) {
      fallback();
      return;
    }
    navigator.clipboard.writeText(link).then(
      () => {
        if (alive.current) setCopied(true);
      },
      fallback,
    );
  };

  const q = query.trim().toLowerCase();
  const shown =
    entries.kind === "ready"
      ? entries.rows.filter(
          (e) =>
            !q ||
            e.handle.toLowerCase().includes(q) ||
            (e.firstName ?? "").toLowerCase().includes(q) ||
            (e.email ?? "").toLowerCase().includes(q),
        )
      : [];

  const current = session.kind === "ready" ? session.session : null;
  const placeCount = Math.max(raffle.prizes.length, ...drawRows.map((d) => d.place), 0);
  const drawByPlace = new Map(drawRows.map((d) => [d.place, d]));

  return (
    <>
      {/* ------------------------------------------------------- entries -- */}
      <Panel>
        <PanelHead
          title="ENTRIES"
          count={entries.kind === "ready" ? entries.rows.length : "—"}
          right={<Tag on={raffle.open}>{raffle.open ? "TAKING ENTRIES" : "ENTRIES CLOSED"}</Tag>}
        />

        {entries.kind === "ready" && entries.rows.length > 0 && (
          <div className="border-b border-line px-4 py-3">
            <input
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Find a handle, name or email"
              aria-label="Search entries"
              className={`${field} w-full`}
            />
            {q && (
              <p className="label mt-2 text-silverfaint">
                <span className="text-chalk">{shown.length}</span> OF {entries.rows.length} MATCH
              </p>
            )}
          </div>
        )}

        {entries.kind === "loading" && (
          <PanelBody>
            <Waiting what="READING THE ENTRIES…" />
          </PanelBody>
        )}
        {entries.kind === "error" && (
          <PanelBody>
            <Failed message={entries.message} onRetry={retry} />
          </PanelBody>
        )}
        {entries.kind === "ready" &&
          (entries.rows.length === 0 ? (
            <PanelBody>
              <Empty>The entry list loaded and it is empty. Nobody has entered this raffle yet.</Empty>
            </PanelBody>
          ) : shown.length === 0 ? (
            <PanelBody>
              <Empty>Nobody in this raffle matches that.</Empty>
            </PanelBody>
          ) : (
            <ul>
              {shown.map((e) => {
                const handle = atHandle(e.handle);
                return (
                  <li key={e.userId} className="border-b border-line px-4 py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                        <Avatar path={e.avatarPath} name={e.handle || e.email || "?"} />
                        <div className="min-w-0">
                          <p className="truncate text-[0.9375rem] text-chalk">
                            {handle || "—"}
                            {e.firstName && <span className="ml-2 text-silverdim">{e.firstName}</span>}
                          </p>
                          <p className="label break-all text-silverdim">{e.email ?? "—"}</p>
                          <p className="label text-silverfaint">ENTERED {moment(e.enteredAt)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void remove(e)}
                        disabled={removing !== null}
                        className={`${dangerBtn} w-full sm:w-auto`}
                      >
                        {removing === e.userId ? "REMOVING…" : "REMOVE"}
                      </button>
                    </div>
                    {removeError?.userId === e.userId && (
                      <Refused message={removeError.message} className="mt-2" />
                    )}
                  </li>
                );
              })}
            </ul>
          ))}
      </Panel>

      {/* ----------------------------------------------------- live draw -- */}
      <Panel>
        <PanelHead
          title="LIVE DRAW"
          right={
            current ? (
              <span className="label flex items-center gap-2 text-chalk">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-bloodhi" />
                LIVE
              </span>
            ) : undefined
          }
        />

        {session.kind === "loading" && (
          <PanelBody>
            <Waiting what="CHECKING FOR A LIVE LINK…" />
          </PanelBody>
        )}
        {session.kind === "error" && (
          <PanelBody>
            <Failed message={session.message} onRetry={retry} />
          </PanelBody>
        )}

        {session.kind === "ready" && (
          <PanelBody className="flex flex-col gap-4">
            {current ? (
              <LiveLink
                session={current}
                now={now}
                copied={copied}
                inputRef={linkInput}
                onCopy={copy}
                onEnd={() => void stopLive()}
                ending={liveBusy === "end"}
              />
            ) : (
              <div>
                <p className="text-[0.9375rem] leading-relaxed text-silverdim">
                  No live link is running. Going live closes entries and makes a link anyone can
                  open for one hour to watch the wheel.
                </p>
                {entries.kind === "ready" && entries.rows.length === 0 && (
                  <p className="label mt-2 leading-loose text-silverfaint">
                    NOBODY HAS ENTERED YET - THE WHEEL WOULD BE EMPTY.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void startLive()}
                  disabled={liveBusy !== null}
                  className={`${btnGo} mt-4 w-full sm:w-auto`}
                >
                  {liveBusy === "go" ? "Going live…" : "Go live"}
                </button>
              </div>
            )}

            {liveError && <Refused message={liveError} />}

            <p className="label leading-loose text-silverfaint">
              THE SPIN BUTTONS ARE ON THE LIVE PAGE. OPEN THE LINK WHILE SIGNED IN AS AN ADMIN AND
              EACH PLACE GETS ITS OWN SPIN BUTTON - EVERYONE WATCHING SEES THE SAME RESULT.
            </p>

            {stale && (
              <p className="label leading-loose text-bloodhi" role="alert">
                THE LAST REFRESH FAILED - {stale}. SHOWING WHAT WAS LAST READ.
              </p>
            )}
          </PanelBody>
        )}

        {/* ----------------------------------------------------- winners -- */}
        <div className="border-t border-line">
          <p className="label border-b border-line px-4 py-3 text-silverfaint">
            WINNERS SO FAR{" "}
            <span className="ml-1 text-chalk">
              {draws.kind === "ready" ? `${drawRows.length} / ${raffle.prizes.length}` : "—"}
            </span>
          </p>

          {draws.kind === "loading" && (
            <PanelBody>
              <Waiting what="READING THE WINNERS…" />
            </PanelBody>
          )}
          {draws.kind === "error" && (
            <PanelBody>
              <Failed message={draws.message} onRetry={retry} />
            </PanelBody>
          )}
          {draws.kind === "ready" &&
            (placeCount === 0 ? (
              <PanelBody>
                <Empty>This raffle has no prize places yet. Add them under Details and save.</Empty>
              </PanelBody>
            ) : (
              <ol>
                {Array.from({ length: placeCount }, (_, i) => i + 1).map((place) => {
                  const draw = drawByPlace.get(place);
                  const winner = draw ? byUser.get(draw.userId) : undefined;
                  const name = draw
                    ? entries.kind !== "ready"
                      ? "…"
                      : winner
                        ? atHandle(winner.handle) || winner.email || "—"
                        : "A removed entrant"
                    : null;
                  return (
                    <li key={place} className="border-b border-line px-4 py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                          <span className="font-display flex h-10 w-10 shrink-0 items-center justify-center border border-line text-silverdim">
                            {place}
                          </span>
                          <div className="min-w-0">
                            <p className="label truncate text-silverfaint">
                              {placeName(raffle.prizes, place)}
                            </p>
                            {draw ? (
                              <p className="truncate text-[0.9375rem] text-chalk">
                                {name}
                                <span className="label ml-2 text-silverfaint">{moment(draw.drawnAt)}</span>
                              </p>
                            ) : (
                              <p className="label text-silverfaint">NOT DRAWN YET</p>
                            )}
                          </div>
                        </div>
                        {draw && (
                          <button
                            type="button"
                            onClick={() => void clear(place)}
                            disabled={clearing !== null}
                            className={`${dangerBtn} w-full sm:w-auto`}
                          >
                            {clearing === place ? "CLEARING…" : "CLEAR"}
                          </button>
                        )}
                      </div>
                      {clearError?.place === place && (
                        <Refused message={clearError.message} className="mt-2" />
                      )}
                    </li>
                  );
                })}
              </ol>
            ))}
        </div>
      </Panel>
    </>
  );
}

function LiveLink({
  session,
  now,
  copied,
  inputRef,
  onCopy,
  onEnd,
  ending,
}: {
  session: LiveSession;
  now: number;
  copied: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onCopy: (link: string) => void;
  onEnd: () => void;
  ending: boolean;
}) {
  const link = liveLink(session.token);
  const left = now ? Date.parse(session.expiresAt) - now : null;
  const expired = left !== null && left <= 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label text-silverfaint">LINK WORKS FOR ANOTHER</p>
          <p
            className={`font-display mt-1 text-[clamp(1.75rem,7vw,2.25rem)] leading-none tabular-nums ${
              expired ? "text-bloodhi" : "text-chalk"
            }`}
            aria-live="off"
          >
            {left === null ? "--:--" : clock(left)}
          </p>
        </div>
        <p className="label text-silverfaint">
          {expired ? "EXPIRED - REFRESHING…" : `ENDS ${new Date(session.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
        </p>
      </div>

      <label className="label block text-silverfaint" htmlFor="raffle-live-link">
        LIVE LINK
      </label>
      <input
        id="raffle-live-link"
        ref={inputRef}
        value={link}
        readOnly
        onFocus={(ev) => ev.currentTarget.select()}
        className={`${field} label w-full text-silver`}
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onCopy(link)} className={btnGo}>
          {copied ? "Copied" : "Copy"}
        </button>
        <a href={link} target="_blank" rel="noopener noreferrer" className={btn}>
          Open
        </a>
      </div>
      <button
        type="button"
        onClick={onEnd}
        disabled={ending}
        className="font-display min-h-11 w-full border border-line py-3 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi disabled:opacity-50"
      >
        {ending ? "Ending…" : "End live now"}
      </button>
    </div>
  );
}
