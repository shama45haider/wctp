"use client";

import { useState } from "react";
import { removeEvent } from "@/lib/admin-data";

/**
 * The admin's delete control on a flyer on the home page.
 *
 * Sits over the corner of the card as a sibling of its link rather than
 * inside it, so a tap here never also opens the event. Two taps: the first
 * turns it into a confirm, which is the only thing between a thumb and a date
 * vanishing from the site for everyone.
 */
export default function DeleteEventButton({
  slug,
  title,
  onDeleted,
}: {
  slug: string;
  title: string;
  onDeleted: (slug: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const out = await removeEvent(slug);
    setBusy(false);
    if (!out.ok) {
      setConfirming(false);
      setError(out.error ?? "That did not delete.");
      return;
    }
    onDeleted(slug);
  };

  const chip =
    "label min-h-11 border bg-void/90 px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="absolute top-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-end gap-1">
      {confirming ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className={`${chip} border-bloodhi text-bloodhi hover:bg-blood hover:text-chalk`}
          >
            {busy ? "DELETING…" : "DELETE IT"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className={`${chip} border-line text-silverdim hover:text-chalk`}
          >
            KEEP
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className={`${chip} border-line text-silverdim hover:border-bloodhi hover:text-bloodhi`}
        >
          DELETE <span className="sr-only">{title}</span>
        </button>
      )}
      {error && (
        <p role="alert" className="label bg-void/90 px-2 py-1 leading-loose text-bloodhi">
          {error}
        </p>
      )}
    </div>
  );
}
