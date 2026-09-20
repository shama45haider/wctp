"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Editable } from "./Editable";
import { avatarUrl } from "@/lib/profile-data";
import {
  acceptRequest,
  findMember,
  listFriends,
  removeFriend,
  sendRequest,
  type Friend,
} from "@/lib/friends";
import { btnGo, field } from "@/lib/ui";

/**
 * Friends, added by the handle they already go by.
 *
 * Two steps rather than one: look the handle up, see whose face comes back,
 * then send. A single "add" button on a typed handle sends requests to
 * strangers with similar names, and there is no undoing somebody else's
 * notification.
 */

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: Friend[] };

type Found =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "missing"; message: string }
  | { kind: "found"; id: string; handle: string; avatarPath: string | null };

function Face({ path, handle }: { path: string | null; handle: string }) {
  const url = avatarUrl(path);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-9 w-9 shrink-0 rounded-full border border-line object-cover"
    />
  ) : (
    <span className="label flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-silverfaint">
      {handle.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function FriendsPanel() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<Found>({ kind: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    const { rows, error } = await listFriends();
    if (!alive.current) return;
    setLoad(error ? { kind: "error", message: error } : { kind: "ready", rows });
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    setFound({ kind: "looking" });
    const { member, error } = await findMember(handle);
    if (!alive.current) return;
    setFound(
      member
        ? {
            kind: "found",
            id: member.id,
            handle: member.handle,
            avatarPath: member.avatarPath,
          }
        : { kind: "missing", message: error ?? "Not found." },
    );
  };

  const ask = async (id: string) => {
    setBusy(id);
    const out = await sendRequest(id);
    if (!alive.current) return;
    setBusy(null);
    if (!out.ok) {
      setFound({ kind: "missing", message: out.error ?? "That did not send." });
      return;
    }
    setHandle("");
    setFound({ kind: "idle" });
    void read();
  };

  const act = async (id: string, work: () => Promise<{ ok: boolean }>) => {
    setBusy(id);
    await work();
    if (!alive.current) return;
    setBusy(null);
    void read();
  };

  const rows = load.kind === "ready" ? load.rows : [];
  const incoming = rows.filter(
    (r) => r.status === "pending" && r.direction === "received",
  );
  const outgoing = rows.filter(
    (r) => r.status === "pending" && r.direction === "sent",
  );
  const friends = rows.filter((r) => r.status === "accepted");

  return (
    <section className="mt-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <h2 className="font-display text-[2rem]">
          <Editable k="account.friends.title">Friends</Editable>
          {friends.length > 0 && (
            <span className="label ml-3 align-middle text-silverfaint">
              {friends.length}
            </span>
          )}
        </h2>
      </div>

      {/* ------------------------------------------------------- add one -- */}
      <form onSubmit={look} className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-0 flex-1">
          <label htmlFor="friendhandle" className="label text-silverfaint uppercase">
            <Editable k="account.friends.find">Instagram handle</Editable>
          </label>
          <div className="mt-2 flex items-center">
            <span className="label flex min-h-11 shrink-0 items-center border border-r-0 border-line bg-[#0a0b0d] px-3 text-silverfaint">
              @
            </span>
            <input
              id="friendhandle"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setFound({ kind: "idle" });
              }}
              placeholder="theirhandle"
              className={`${field} w-full min-w-0`}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={!handle.trim() || found.kind === "looking"}
          className={btnGo}
        >
          {found.kind === "looking" ? "Looking…" : "Look up"}
        </button>
      </form>

      {found.kind === "missing" && (
        <p className="mt-3 text-[0.875rem] text-bloodhi" role="alert">
          {found.message}
        </p>
      )}

      {found.kind === "found" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border border-line bg-ink px-4 py-3">
          <Face path={found.avatarPath} handle={found.handle} />
          <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-chalk">
            @{found.handle}
          </span>
          <button
            type="button"
            onClick={() => void ask(found.id)}
            disabled={busy === found.id}
            className="label flex min-h-11 items-center border border-linehi px-4 tracking-[0.11em] text-silverdim uppercase transition-colors hover:border-chalk hover:text-chalk disabled:opacity-40"
          >
            {busy === found.id ? "Sending…" : "Send request"}
          </button>
        </div>
      )}

      {load.kind === "error" && (
        <p
          className="mt-5 border border-[rgba(200,16,46,0.45)] px-4 py-3 text-[0.875rem] leading-relaxed text-bloodhi"
          role="alert"
        >
          {load.message}
        </p>
      )}

      {/* ------------------------------------------------------ waiting -- */}
      {incoming.length > 0 && (
        <>
          <p className="label mt-8 mb-3 text-silverdim uppercase">
            <Editable k="account.friends.incoming">Waiting on you</Editable>
          </p>
          <ul className="border-t border-line">
            {incoming.map((r) => (
              <li
                key={r.userId}
                className="flex flex-wrap items-center gap-3 border-b border-linesoft py-3"
              >
                <Face path={r.avatarPath} handle={r.handle} />
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-chalk">
                  @{r.handle}
                </span>
                <button
                  type="button"
                  onClick={() => void act(r.userId, () => acceptRequest(r.userId))}
                  disabled={busy === r.userId}
                  className="label min-h-9 border border-linehi px-3 tracking-[0.11em] text-chalk uppercase transition-colors hover:bg-ink2 disabled:opacity-40"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => void act(r.userId, () => removeFriend(r.userId))}
                  disabled={busy === r.userId}
                  className="label min-h-9 px-2 text-silverfaint uppercase transition-colors hover:text-bloodhi disabled:opacity-40"
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* --------------------------------------------------------- list -- */}
      {(friends.length > 0 || outgoing.length > 0) && (
        <ul className="mt-8 border-t border-line">
          {friends.map((r) => (
            <li
              key={r.userId}
              className="flex flex-wrap items-center gap-3 border-b border-linesoft py-3"
            >
              <Face path={r.avatarPath} handle={r.handle} />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-chalk">
                @{r.handle}
              </span>
              <button
                type="button"
                onClick={() => void act(r.userId, () => removeFriend(r.userId))}
                disabled={busy === r.userId}
                className="label min-h-9 px-2 text-silverfaint uppercase transition-colors hover:text-bloodhi disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}

          {outgoing.map((r) => (
            <li
              key={r.userId}
              className="flex flex-wrap items-center gap-3 border-b border-linesoft py-3 opacity-60"
            >
              <Face path={r.avatarPath} handle={r.handle} />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-silverdim">
                @{r.handle}
              </span>
              <span className="label text-silverfaint uppercase">Asked</span>
              <button
                type="button"
                onClick={() => void act(r.userId, () => removeFriend(r.userId))}
                disabled={busy === r.userId}
                className="label min-h-9 px-2 text-silverfaint uppercase transition-colors hover:text-bloodhi disabled:opacity-40"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      {load.kind === "ready" && rows.length === 0 && (
        <div className="mt-6 border border-dashed border-line px-4 py-6 text-center">
          <p className="text-[0.9375rem] leading-relaxed text-silverdim">
            <Editable k="account.friends.empty">
              Nobody yet. Add someone by the handle they use here.
            </Editable>
          </p>
        </div>
      )}
    </section>
  );
}
