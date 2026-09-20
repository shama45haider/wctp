"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { avatarUrl } from "@/lib/profile-data";
import { useAccount } from "@/lib/demo-account";
import {
  findMember,
  listFriends,
  sendRequest,
  acceptRequest,
  type Friend,
} from "@/lib/friends";
import { rankOf } from "@/lib/xp";

/**
 * The card that opens when you tap somebody's handle.
 *
 * Deliberately little: a face, a handle, where they stand, and the one thing
 * you might want to do about them. It is not a profile page and must not
 * become one - everything the site knows about a member is a great deal more
 * than another member should see.
 *
 * The board hands over a handle rather than an id, so the id is fetched on
 * open through find_member(). That is one round trip per tap, which is the
 * right trade: putting ids in the board's payload would publish a stable
 * identifier for every member on a page anyone signed in can read.
 */

type Who =
  | { kind: "looking" }
  | { kind: "missing"; message: string }
  | { kind: "found"; id: string; handle: string; avatarPath: string | null };

/** Where this member already stands with you. */
type Tie = "none" | "friends" | "sent" | "received" | "self";

export default function MemberCard({
  handle,
  total,
  onClose,
}: {
  handle: string;
  /** Their XP, when the opener already knows it. The card does not fetch it. */
  total?: number;
  onClose: () => void;
}) {
  const { user } = useAccount();
  const [who, setWho] = useState<Who>({ kind: "looking" });
  const [tie, setTie] = useState<Tie>("none");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const alive = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  const closer = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async (id: string) => {
    const { rows } = await listFriends();
    if (!alive.current) return;
    const row = rows.find((r: Friend) => r.userId === id);
    setTie(
      !row
        ? "none"
        : row.status === "accepted"
          ? "friends"
          : row.direction === "sent"
            ? "sent"
            : "received",
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const { member, error } = await findMember(handle);
      if (!alive.current) return;
      if (!member) {
        setWho({ kind: "missing", message: error ?? "Not found." });
        // find_member() excludes the caller, so the one handle it will never
        // return is your own - which is worth saying rather than "not found".
        if (user && handle.toLowerCase() === user.name.toLowerCase()) {
          setTie("self");
          setWho({ kind: "missing", message: "That is you." });
        }
        return;
      }
      setWho({
        kind: "found",
        id: member.id,
        handle: member.handle,
        avatarPath: member.avatarPath,
      });
      void refresh(member.id);
    })();
    return () => {
      alive.current = false;
    };
  }, [handle, refresh, user]);

  // Escape closes, and focus starts inside so a keyboard is not left behind
  // on the page underneath.
  useEffect(() => {
    closer.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (work: () => Promise<{ ok: boolean; error?: string }>) => {
    if (who.kind !== "found") return;
    setBusy(true);
    setSaid(null);
    const out = await work();
    if (!alive.current) return;
    setBusy(false);
    if (!out.ok) {
      setSaid(out.error ?? "That did not go through.");
      return;
    }
    void refresh(who.id);
  };

  const face = who.kind === "found" ? avatarUrl(who.avatarPath) : null;
  const rank = typeof total === "number" ? rankOf(total) : null;

  return (
    <div
      // The scrim is the click target for dismissing, so a tap anywhere off
      // the card closes it the way every popover on a phone does.
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/75 p-4 backdrop-blur-sm sm:items-center"
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={`@${handle}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[22rem] border border-linehi bg-ink"
      >
        <div className="flex items-start gap-4 p-5">
          {face ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={face}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full border border-linehi object-cover"
            />
          ) : (
            <span className="font-display flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-linehi text-[1.5rem] text-silverfaint">
              {handle.slice(0, 1).toUpperCase()}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-display text-[1.25rem] leading-tight break-words text-chalk">
              @{handle}
            </p>
            {rank && (
              <p className="label mt-1.5 text-silverdim">
                {rank.name}
                <span className="text-silverfaint"> · </span>
                <span className="tabular-nums">{total} XP</span>
              </p>
            )}
          </div>

          <button
            ref={closer}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="label -mt-1 shrink-0 px-2 text-silverfaint transition-colors hover:text-chalk"
          >
            ✕
          </button>
        </div>

        <div className="border-t border-linesoft p-4">
          {who.kind === "looking" && (
            <p className="label animate-pulse text-silverfaint uppercase">Looking…</p>
          )}

          {who.kind === "missing" && (
            <p className="text-[0.875rem] leading-relaxed text-silverfaint">
              {who.message}
            </p>
          )}

          {who.kind === "found" && (
            <>
              {tie === "friends" && (
                <p className="label text-silverdim uppercase">Already friends</p>
              )}

              {tie === "sent" && (
                <p className="label text-silverfaint uppercase">Request sent</p>
              )}

              {tie === "received" && (
                <button
                  type="button"
                  onClick={() => void act(() => acceptRequest(who.id))}
                  disabled={busy}
                  className="label flex min-h-11 w-full items-center justify-center border border-linehi tracking-[0.11em] text-chalk uppercase transition-colors hover:bg-ink2 disabled:opacity-40"
                >
                  {busy ? "…" : "Accept their request"}
                </button>
              )}

              {tie === "none" && (
                <button
                  type="button"
                  onClick={() => void act(() => sendRequest(who.id))}
                  disabled={busy}
                  className="label flex min-h-11 w-full items-center justify-center border border-linehi tracking-[0.11em] text-silverdim uppercase transition-colors hover:border-chalk hover:bg-ink2 hover:text-chalk disabled:opacity-40"
                >
                  {busy ? "Sending…" : "Add friend"}
                </button>
              )}

              {said && (
                <p className="mt-3 text-[0.8125rem] text-bloodhi" role="alert">
                  {said}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
