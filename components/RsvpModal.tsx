"use client";

import { useEffect, useState } from "react";
import type { Event } from "@/lib/events";
import { monthOf, dayOf } from "@/lib/events";

export default function RsvpModal({
  event,
  onClose,
}: {
  event: Event;
  onClose: () => void;
}) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = `${event.dow} ${dayOf(event.date)} ${monthOf(event.date)} · ${event.venue.toUpperCase()} · ${event.time}`;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(3,3,4,0.86)] p-6 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto border border-linehi bg-gradient-to-b from-ink2 to-[#08090b] p-8"
      >
        {done ? (
          <div className="py-4 text-center">
            <h3 className="font-display text-4xl">You&apos;re on the list</h3>
            <p className="label mt-2 text-silverdim">
              CONFIRMATION SENT TO YOUR EMAIL
            </p>
            <div className="my-5 border border-dashed border-linehi p-4 font-mono text-xl tracking-[0.14em] text-chalk">
              WCTP-4K92-{event.slug.slice(0, 4).toUpperCase()}
            </div>
            <p className="label text-silverdim">SHOW THIS AT THE DOOR</p>
            <button
              onClick={onClose}
              className="font-display mt-6 w-full border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-[1.15rem] py-[0.6rem] tracking-[0.12em] text-chalk uppercase hover:border-silverdim"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="label mb-3 flex items-center gap-2 text-bloodhi">
              <span className="dot" />
              SPOTS REMAINING
            </div>
            <h3 className="font-display text-4xl">{event.title}</h3>
            <p className="label mt-1 mb-7 text-silverdim">{meta}</p>

            <div className="label mb-6 border border-line p-3 text-silverfaint">
              HOLD EXPIRES IN 19:47
            </div>

            {[
              { id: "name", label: "FULL NAME", ph: "Who's coming?", type: "text" },
              { id: "email", label: "EMAIL", ph: "you@domain.com", type: "email" },
              { id: "ig", label: "INSTAGRAM", ph: "@yourhandle", type: "text" },
            ].map((f) => (
              <div key={f.id} className="mb-4 flex flex-col gap-2">
                <label htmlFor={f.id} className="label text-silverfaint">
                  {f.label}
                </label>
                <input
                  id={f.id}
                  type={f.type}
                  placeholder={f.ph}
                  className="border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none"
                />
              </div>
            ))}

            <div className="mb-4 flex flex-col gap-2">
              <label htmlFor="size" className="label text-silverfaint">
                PARTY SIZE
              </label>
              <select
                id="size"
                className="border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk focus:border-silverdim focus:outline-none"
              >
                <option>Just me</option>
                <option>Me + 1</option>
                <option>Me + 2</option>
              </select>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={onClose}
                className="font-display flex-1 border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-[0.6rem] tracking-[0.12em] text-chalk uppercase hover:border-silverdim"
              >
                Cancel
              </button>
              <button
                onClick={() => setDone(true)}
                className="font-display flex-1 border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-[0.6rem] tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)]"
              >
                Confirm
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
