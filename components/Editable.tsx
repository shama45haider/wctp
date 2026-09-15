"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { loadCopy, resetCopy, saveCopy } from "@/lib/site-copy";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * Page text an admin can rewrite in place.
 *
 * <Editable k="home.archive.blurb">Everything we've thrown.</Editable>
 *
 * The children are the bundled default and are what every visitor sees on
 * the first paint, so the static export and hydration agree. CopyProvider
 * (mounted once in the root layout) then loads saved overrides and, for an
 * admin, puts a small pencil after each piece of text that opens an editor.
 *
 * The provider owns the one auth check and the one fetch for the whole page:
 * useSupabaseAuth opens its own subscription and admin lookup per call, and
 * a page has dozens of these.
 */

type Ctx = {
  copy: Map<string, string> | null;
  canEdit: boolean;
  open: (k: string, fallback: string) => void;
  /** Puts a value already saved to site_copy on screen everywhere (null = back to default). */
  apply: (k: string, next: string | null) => void;
};

const CopyContext = createContext<Ctx>({
  copy: null,
  canEdit: false,
  open: () => {},
  apply: () => {},
});

/** For editors of values that aren't a single visible sentence - a link's URL, say. */
export function useCopyEditing() {
  const { copy, canEdit, apply } = useContext(CopyContext);
  return { copy, canEdit, apply };
}

const TOGGLE_KEY = "wctp.editButtons";

export function CopyProvider({ children }: { children: React.ReactNode }) {
  const { ready, isAdmin } = useSupabaseAuth();
  const pathname = usePathname();
  const [copy, setCopy] = useState<Map<string, string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ k: string; fallback: string } | null>(null);
  const [showButtons, setShowButtons] = useState(true);

  useEffect(() => {
    let live = true;
    void loadCopy().then(({ copy: loaded, error }) => {
      if (!live) return;
      setCopy(loaded);
      setLoadError(error ?? null);
    });
    try {
      const saved = window.localStorage.getItem(TOGGLE_KEY);
      if (saved === "off") queueMicrotask(() => live && setShowButtons(false));
    } catch {}
    return () => {
      live = false;
    };
  }, []);

  const onAdminPage = pathname?.startsWith("/admin") ?? false;
  const isEditor = ready && isAdmin && !onAdminPage;
  const canEdit = isEditor && showButtons;

  const toggle = () => {
    setShowButtons((on) => {
      try {
        window.localStorage.setItem(TOGGLE_KEY, on ? "off" : "on");
      } catch {}
      return !on;
    });
  };

  const open = useCallback((k: string, fallback: string) => setEditing({ k, fallback }), []);

  const applied = useCallback((k: string, next: string | null) => {
    setCopy((prev) => {
      const m = new Map(prev ?? []);
      if (next === null) m.delete(k);
      else m.set(k, next);
      return m;
    });
  }, []);

  const value = useMemo(
    () => ({ copy, canEdit, open, apply: applied }),
    [copy, canEdit, open, applied],
  );

  return (
    <CopyContext.Provider value={value}>
      {children}

      {isEditor && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={showButtons}
          className="label fixed left-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[10000] flex lg:bottom-4 min-h-11 items-center gap-2 border border-linehi bg-void/90 px-3 text-silver backdrop-blur transition-colors hover:border-silverdim hover:text-chalk"
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${showButtons ? "bg-bloodhi" : "bg-silverfaint"}`}
          />
          {showButtons ? "EDIT BUTTONS ON" : "EDIT BUTTONS OFF"}
        </button>
      )}

      {isEditor && loadError && showButtons && (
        <p
          role="alert"
          className="label fixed left-4 bottom-[calc(8rem+env(safe-area-inset-bottom))] z-[10000] lg:bottom-18 max-w-[min(22rem,calc(100vw-2rem))] border border-[rgba(200,16,46,0.5)] bg-void/95 px-3 py-2 leading-loose text-bloodhi"
        >
          SAVED TEXT DID NOT LOAD - {loadError.toUpperCase()}
        </p>
      )}

      {canEdit && editing && (
        <EditDialog
          key={editing.k}
          k={editing.k}
          fallback={editing.fallback}
          current={copy?.get(editing.k)}
          onClose={() => setEditing(null)}
          onApplied={applied}
        />
      )}
    </CopyContext.Provider>
  );
}

/** The text for `k`: the saved override once loaded, otherwise the default. */
export function useCopy(k: string, fallback: string): string {
  const { copy } = useContext(CopyContext);
  return copy?.get(k) ?? fallback;
}

export function Editable({ k, children }: { k: string; children: string }) {
  const { copy, canEdit, open } = useContext(CopyContext);
  const text = copy?.get(k) ?? children;
  const lines = text.split("\n");

  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line}
        </span>
      ))}
      {canEdit && (
        <button
          type="button"
          className="edit-pencil"
          aria-label={`Edit text: ${text.slice(0, 60) || k}`}
          title="Edit this text"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            open(k, children);
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M11.3 2.2a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1L6 12.5 2.5 13.5l1-3.5 7.8-7.8Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </>
  );
}

function EditDialog({
  k,
  fallback,
  current,
  onClose,
  onApplied,
}: {
  k: string;
  fallback: string;
  current: string | undefined;
  onClose: () => void;
  onApplied: (k: string, next: string | null) => void;
}) {
  const [draft, setDraft] = useState(current ?? fallback);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setBusy("save");
    setError(null);
    const out = await saveCopy(k, draft);
    setBusy(null);
    if (!out.ok) return setError(out.error ?? "Could not save.");
    onApplied(k, draft);
    onClose();
  };

  const reset = async () => {
    setBusy("reset");
    setError(null);
    const out = await resetCopy(k);
    setBusy(null);
    if (!out.ok) return setError(out.error ?? "Could not reset.");
    onApplied(k, null);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-copy-title"
        className="w-full border-t border-linehi bg-ink p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-xl sm:border sm:pb-5"
      >
        <div className="flex items-baseline justify-between gap-4">
          <p id="edit-copy-title" className="label text-chalk">
            EDIT TEXT
          </p>
          <p className="label truncate text-silverfaint">{k}</p>
        </div>

        <textarea
          ref={area}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          rows={Math.min(10, Math.max(3, Math.ceil(draft.length / 48) + draft.split("\n").length - 1))}
          maxLength={5000}
          className={`${field} mt-4 w-full resize-y leading-relaxed`}
        />

        {current !== undefined && current !== fallback && (
          <p className="mt-3 text-[0.875rem] leading-relaxed text-silverfaint">
            <span className="label text-silverdim">DEFAULT: </span>
            {fallback}
          </p>
        )}

        {error && (
          <p className="label mt-3 leading-loose text-bloodhi" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null}
            className={btnGo}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} disabled={busy !== null} className={btn}>
            Cancel
          </button>
          {current !== undefined && (
            <button
              type="button"
              onClick={() => void reset()}
              disabled={busy !== null}
              className="label ml-auto min-h-11 px-2 text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk disabled:opacity-50"
            >
              {busy === "reset" ? "RESETTING…" : "RESET TO DEFAULT"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
