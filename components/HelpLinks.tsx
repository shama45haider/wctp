"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCopyEditing } from "./Editable";
import { org } from "@/lib/events";
import { resetCopy, saveCopy } from "@/lib/site-copy";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * The Help page's link list, Linktree-style.
 *
 * Every field of every link - name, subtitle, URL, icon, shown or hidden - is
 * saved as page text in site_copy under help.link.<id>.<field>, the same table
 * <Editable> uses, so there's nothing extra in the database and an admin edits
 * them from this page. The values below are only the defaults.
 *
 * A link with no working URL, or switched off, isn't shown to guests at all,
 * so nobody lands on a placeholder. Admins see every slot with an Edit button.
 */

const ICONS = {
  instagram: {
    label: "Instagram",
    svg: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.25" cy="6.75" r="0.6" fill="currentColor" />
      </>
    ),
  },
  tiktok: {
    label: "TikTok",
    svg: (
      <>
        <path d="M14.5 3.5v10.75a3.75 3.75 0 1 1-3.75-3.75" />
        <path d="M14.5 3.5c.35 2.7 2.35 4.6 5 4.85" />
      </>
    ),
  },
  posh: {
    label: "Tickets",
    svg: (
      <>
        <path d="M3.5 7.5a2 2 0 0 0 2-2h13a2 2 0 0 0 2 2v2.75a1.75 1.75 0 0 0 0 3.5v2.75a2 2 0 0 0-2 2h-13a2 2 0 0 0-2-2v-2.75a1.75 1.75 0 0 0 0-3.5z" />
        <path d="M14.5 6v2M14.5 11v2M14.5 16v2" />
      </>
    ),
  },
  youtube: {
    label: "YouTube",
    svg: (
      <>
        <rect x="2.75" y="5.5" width="18.5" height="13" rx="3.5" />
        <path d="m10.25 9.25 4.5 2.75-4.5 2.75z" />
      </>
    ),
  },
  soundcloud: {
    label: "SoundCloud",
    svg: (
      <>
        <path d="M8 17.5h9.5a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 8 9.1" />
        <path d="M5.5 11v6.5M3 13v4.5" />
      </>
    ),
  },
  spotify: {
    label: "Spotify",
    svg: (
      <>
        <circle cx="12" cy="12" r="8.75" />
        <path d="M7.5 9.75c3-.9 6.4-.65 9 .85M8 12.75c2.4-.65 5-.45 7 .7M8.6 15.6c1.8-.45 3.6-.3 5.1.5" />
      </>
    ),
  },
  x: { label: "X", svg: <path d="M4.5 4.5 19.5 19.5M19.5 4.5 4.5 19.5" /> },
  email: {
    label: "Email",
    svg: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
  },
  link: {
    label: "Link",
    svg: (
      <>
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1-1" />
      </>
    ),
  },
} as const;

type IconName = keyof typeof ICONS;
const isIcon = (v: string): v is IconName => Object.prototype.hasOwnProperty.call(ICONS, v);

type LinkValues = { label: string; note: string; url: string; icon: IconName; hidden: boolean };
type LinkSlot = { id: string } & LinkValues;

const DEFAULTS: LinkSlot[] = [
  { id: "instagram", label: "Instagram", note: org.instagramHandle, url: org.instagram, icon: "instagram", hidden: false },
  { id: "posh", label: "Tickets on Posh", note: "Every date, first", url: org.posh, icon: "posh", hidden: false },
  { id: "tiktok", label: "TikTok", note: "Clips from the nights", url: "", icon: "tiktok", hidden: false },
  { id: "link4", label: "Your link here", note: "Tap Edit to set this one up", url: "", icon: "link", hidden: false },
  { id: "link5", label: "Your link here", note: "Tap Edit to set this one up", url: "", icon: "link", hidden: false },
  { id: "link6", label: "Your link here", note: "Tap Edit to set this one up", url: "", icon: "link", hidden: false },
];

const FIELDS = ["label", "note", "url", "icon", "hidden"] as const;
const copyKey = (id: string, field: (typeof FIELDS)[number]) => `help.link.${id}.${field}`;

/** A link a browser can safely open, or null. Bare "tiktok.com/@x" gets https:// in front. */
function safeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return ["https:", "http:", "mailto:", "tel:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

const isWeb = (url: string) => /^https?:/i.test(url);

function Icon({ name, className }: { name: IconName; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name].svg}
    </svg>
  );
}

function LinkEditor({
  slot,
  current,
  onClose,
  apply,
}: {
  slot: LinkSlot;
  current: LinkValues;
  onClose: () => void;
  apply: (k: string, next: string | null) => void;
}) {
  const [label, setLabel] = useState(current.label);
  const [note, setNote] = useState(current.note);
  const [url, setUrl] = useState(current.url);
  const [icon, setIcon] = useState<IconName>(current.icon);
  const [shown, setShown] = useState(!current.hidden);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    const cleanUrl = url.trim() ? safeUrl(url) : "";
    if (cleanUrl === null) {
      setError("That link doesn't look right. Use a full address like https://www.tiktok.com/@yourname");
      return;
    }
    if (!label.trim()) {
      setError("Give the link a name.");
      return;
    }
    const next: Record<(typeof FIELDS)[number], string> = {
      label: label.trim(),
      note: note.trim(),
      url: cleanUrl,
      icon,
      hidden: shown ? "0" : "1",
    };
    const before: Record<(typeof FIELDS)[number], string> = {
      label: current.label,
      note: current.note,
      url: current.url,
      icon: current.icon,
      hidden: current.hidden ? "1" : "0",
    };
    setBusy("save");
    setError(null);
    for (const f of FIELDS) {
      if (next[f] === before[f]) continue;
      const out = await saveCopy(copyKey(slot.id, f), next[f]);
      if (!out.ok) {
        setBusy(null);
        setError(out.error ?? "Could not save.");
        return;
      }
      apply(copyKey(slot.id, f), next[f]);
    }
    setBusy(null);
    onClose();
  };

  const reset = async () => {
    setBusy("reset");
    setError(null);
    for (const f of FIELDS) {
      const out = await resetCopy(copyKey(slot.id, f));
      if (!out.ok) {
        setBusy(null);
        setError(out.error ?? "Could not reset.");
        return;
      }
      apply(copyKey(slot.id, f), null);
    }
    setBusy(null);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-link-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="max-h-[92dvh] w-full overflow-y-auto border-t border-linehi bg-ink p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-left sm:max-w-lg sm:border sm:pb-5"
      >
        <div className="flex items-baseline justify-between gap-4">
          <p id="edit-link-title" className="label text-chalk">
            EDIT LINK
          </p>
          <p className="label truncate text-silverfaint">help.link.{slot.id}</p>
        </div>

        <label htmlFor="link-label" className="label mt-5 block text-silverfaint">
          NAME
        </label>
        <input
          ref={first}
          id="link-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          className={`${field} mt-2 w-full`}
        />

        <label htmlFor="link-note" className="label mt-4 block text-silverfaint">
          SUBTITLE <span className="text-silverdim">(OPTIONAL)</span>
        </label>
        <input
          id="link-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
          className={`${field} mt-2 w-full`}
        />

        <label htmlFor="link-url" className="label mt-4 block text-silverfaint">
          LINK
        </label>
        <input
          id="link-url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://"
          className={`${field} mt-2 w-full`}
        />
        <p className="label mt-2 leading-loose text-silverfaint">
          LEAVE EMPTY TO KEEP THIS LINK OFF THE PAGE. MAILTO: AND TEL: WORK TOO.
        </p>

        <p className="label mt-4 text-silverfaint">ICON</p>
        <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-9" role="radiogroup" aria-label="Icon">
          {(Object.keys(ICONS) as IconName[]).map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={icon === name}
              aria-label={ICONS[name].label}
              title={ICONS[name].label}
              onClick={() => setIcon(name)}
              className={`flex min-h-11 items-center justify-center border transition-colors ${
                icon === name
                  ? "border-bloodhi bg-[rgba(200,16,46,0.12)] text-bloodhi"
                  : "border-line text-silverdim hover:border-linehi hover:text-chalk"
              }`}
            >
              <Icon name={name} className="h-5 w-5" />
            </button>
          ))}
        </div>

        <label htmlFor="link-shown" className="mt-5 flex min-h-11 cursor-pointer items-center gap-3">
          <input
            id="link-shown"
            type="checkbox"
            checked={shown}
            onChange={(e) => setShown(e.target.checked)}
            className="h-4 w-4 shrink-0 accent-[#e8213f]"
          />
          <span className="text-sm text-chalk">Show this link on the page</span>
        </label>

        {error && (
          <p className="label mt-3 leading-loose text-bloodhi" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy !== null} className={btnGo}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} disabled={busy !== null} className={btn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy !== null}
            className="label ml-auto min-h-11 px-2 text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk disabled:opacity-50"
          >
            {busy === "reset" ? "RESETTING…" : "RESET TO DEFAULT"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export default function HelpLinks() {
  const { copy, canEdit, apply } = useCopyEditing();
  const [editing, setEditing] = useState<string | null>(null);

  const slots: LinkSlot[] = DEFAULTS.map((d) => {
    const get = (f: (typeof FIELDS)[number], fallback: string) => copy?.get(copyKey(d.id, f)) ?? fallback;
    const icon = get("icon", d.icon);
    return {
      id: d.id,
      label: get("label", d.label),
      note: get("note", d.note),
      url: get("url", d.url),
      icon: isIcon(icon) ? icon : "link",
      hidden: get("hidden", d.hidden ? "1" : "0") === "1",
    };
  });

  const shown = slots.filter((s) => canEdit || (!s.hidden && safeUrl(s.url)));
  const editingSlot = editing ? slots.find((s) => s.id === editing) : undefined;

  return (
    <>
      <ul className="mt-8 flex w-full flex-col gap-3">
        {shown.map((s) => {
          const href = safeUrl(s.url);
          const live = Boolean(href) && !s.hidden;
          const body = (
            <>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-line bg-void text-chalk transition-colors group-hover:border-bloodhi group-hover:text-bloodhi">
                <Icon name={s.icon} className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="font-display block truncate text-[1.2rem] leading-tight">{s.label}</span>
                {s.note && <span className="block truncate text-[0.8125rem] text-silverdim">{s.note}</span>}
              </span>
              {href && (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-silverfaint transition-transform group-hover:translate-x-0.5 group-hover:text-chalk"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </>
          );
          const card =
            "group flex min-h-[4.5rem] flex-1 items-center gap-4 border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-3.5 py-3 transition-all";

          return (
            <li key={s.id} className="flex items-stretch gap-2">
              {href ? (
                <a
                  href={href}
                  {...(isWeb(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className={`${card} hover:-translate-y-0.5 hover:border-bloodhi hover:shadow-[0_14px_40px_-16px_rgba(200,16,46,0.55)] active:translate-y-0 ${
                    live ? "" : "opacity-50"
                  }`}
                >
                  {body}
                </a>
              ) : (
                <div className={`${card} border-dashed opacity-50`}>{body}</div>
              )}

              {canEdit && (
                <div className="flex w-[4.5rem] shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(s.id)}
                    aria-label={`Edit the ${s.label} link`}
                    className="label flex flex-1 items-center justify-center border border-line text-silverdim transition-colors hover:border-bloodhi hover:text-chalk"
                  >
                    EDIT
                  </button>
                  {!live && (
                    <span className="label text-center text-[0.625rem] leading-tight text-bloodhi">
                      {s.hidden ? "HIDDEN" : "NO LINK"}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && editingSlot && (
        <LinkEditor
          key={editingSlot.id}
          slot={editingSlot}
          current={editingSlot}
          onClose={() => setEditing(null)}
          apply={apply}
        />
      )}
    </>
  );
}
