"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Editable } from "./Editable";
import SongRequestBox from "./SongRequestBox";
import {
  listOwnRequests,
  withdrawRequest,
  type SongRequest,
} from "@/lib/song-requests";

/**
 * Everything this guest has asked for, and the form to ask for more.
 *
 * Loading, empty and failed are three different sentences, the way they are
 * everywhere else here: an empty list and a list that did not load look
 * identical if you let them, and "you have asked for nothing" is the wrong
 * thing to tell somebody whose five requests just failed to arrive.
 */

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: SongRequest[] };

export default function SongRequests() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [dropping, setDropping] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    const { rows, error } = await listOwnRequests();
    if (!alive.current) return;
    setLoad(error ? { kind: "error", message: error } : { kind: "ready", rows });
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const drop = async (id: string) => {
    setDropping(id);
    await withdrawRequest(id);
    if (!alive.current) return;
    setDropping(null);
    void read();
  };

  return (
    <section className="mt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <h2 className="font-display text-[2rem]">
          <Editable k="account.songs.title">Song requests</Editable>
          {load.kind === "ready" && load.rows.length > 0 && (
            <span className="label ml-3 align-middle text-silverfaint">
              {load.rows.length}
            </span>
          )}
        </h2>
      </div>

      <SongRequestBox onAdded={() => void read()} />

      {load.kind === "loading" && (
        <p className="label mt-5 animate-pulse text-silverfaint uppercase">
          Loading…
        </p>
      )}

      {load.kind === "error" && (
        <p
          className="mt-5 border border-[rgba(200,16,46,0.45)] px-4 py-3 text-[0.875rem] leading-relaxed text-bloodhi"
          role="alert"
        >
          {load.message}
        </p>
      )}

      {load.kind === "ready" && load.rows.length > 0 && (
        <ul className="mt-6 border-t border-line">
          {load.rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linesoft py-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] break-words text-chalk">
                  {r.song}
                  {r.artist && (
                    <span className="text-silverdim"> — {r.artist}</span>
                  )}
                </p>
                <p className="label mt-1 text-silverfaint">
                  {r.eventTitle ?? (
                    <Editable k="account.songs.anyNight">ANY NIGHT</Editable>
                  )}
                  {r.link && (
                    <>
                      {" · "}
                      {/* The host is fixed by a constraint in 0019, but the
                          rel is still here: this is a link somebody else
                          typed. */}
                      <a
                        href={r.link}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline transition-colors hover:text-chalk"
                      >
                        <Editable k="account.songs.watch">YOUTUBE</Editable>
                      </a>
                    </>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void drop(r.id)}
                disabled={dropping === r.id}
                className="label shrink-0 text-silverfaint transition-colors hover:text-bloodhi disabled:opacity-40"
              >
                {dropping === r.id ? "…" : "REMOVE"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
