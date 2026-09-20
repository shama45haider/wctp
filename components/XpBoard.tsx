"use client";

import { useEffect, useRef, useState } from "react";
import { Editable } from "./Editable";
import { avatarUrl } from "@/lib/profile-data";
import { xpBoard, type BoardRow } from "@/lib/xp";

/**
 * Who is ahead.
 *
 * A handle, a face and a number - never the breakdown. How many parties a
 * named person has been to is a different thing to publish than their score,
 * and ranking them does not need it. Anyone who would rather not be listed
 * turns it off on /profile.
 */

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: BoardRow[] };

export default function XpBoard({ limit = 25 }: { limit?: number }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const { rows, error } = await xpBoard(limit);
      if (!alive.current) return;
      setLoad(error ? { kind: "error", message: error } : { kind: "ready", rows });
    })();
    return () => {
      alive.current = false;
    };
  }, [limit]);

  return (
    <section className="border border-line bg-ink">
      <div className="border-b border-line px-4 py-3.5">
        <p className="label tracking-[0.11em] text-silverdim uppercase">
          <Editable k="board.title">The board</Editable>
        </p>
      </div>

      {load.kind === "loading" && (
        <p className="label animate-pulse px-4 py-4 text-silverfaint uppercase">
          Counting…
        </p>
      )}

      {load.kind === "error" && (
        <p
          className="px-4 py-4 text-[0.875rem] leading-relaxed text-bloodhi"
          role="alert"
        >
          {load.message}
        </p>
      )}

      {load.kind === "ready" && load.rows.length === 0 && (
        <p className="px-4 py-4 text-[0.875rem] leading-relaxed text-silverfaint">
          <Editable k="board.empty">Nobody on it yet.</Editable>
        </p>
      )}

      {load.kind === "ready" && load.rows.length > 0 && (
        <ol>
          {load.rows.map((r, i) => {
            const face = avatarUrl(r.avatarPath);
            return (
              <li
                key={r.handle}
                className="flex items-center gap-3 border-b border-linesoft px-4 py-2.5 last:border-b-0"
              >
                <span
                  className={`label w-5 shrink-0 text-right tabular-nums ${
                    i === 0 ? "text-bloodhi" : "text-silverfaint"
                  }`}
                >
                  {i + 1}
                </span>
                {face ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={face}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="label flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-silverfaint">
                    {r.handle.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[0.875rem] text-chalk">
                  @{r.handle}
                </span>
                <span className="label shrink-0 text-silver tabular-nums">
                  {r.total}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
