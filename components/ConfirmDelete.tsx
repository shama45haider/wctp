"use client";

import { useState } from "react";

/**
 * A two-tap delete for admins: the first tap asks, the second does it. Used
 * wherever an admin removes something straight from the page - a store item,
 * an upcoming date - so the confirm looks and behaves the same everywhere.
 */
export default function ConfirmDelete({
  what,
  onConfirm,
  onDone,
  className = "",
}: {
  /** Read by screen readers after "Delete", e.g. the item's name. */
  what: string;
  onConfirm: () => Promise<{ ok: boolean; error?: string }>;
  onDone: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    const out = await onConfirm();
    setBusy(false);
    if (!out.ok) {
      setConfirming(false);
      setError(out.error ?? "That did not delete.");
      return;
    }
    onDone();
  };

  const pill =
    "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-[0.8125rem] font-medium transition-colors disabled:opacity-50";

  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className={`${pill} bg-blood text-white hover:bg-bloodhi`}
          >
            {busy ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className={`${pill} border border-line-hi text-silver hover:border-chalk`}
          >
            Keep
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className={`${pill} border border-blood text-bloodhi hover:bg-blood hover:text-white`}
        >
          Delete <span className="sr-only">{what}</span>
        </button>
      )}
      {error && (
        <p role="alert" className="label text-bloodhi">
          {error}
        </p>
      )}
    </div>
  );
}
