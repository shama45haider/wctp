"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Editable } from "./Editable";
import MemberCard from "./MemberCard";
import { avatarUrl } from "@/lib/profile-data";
import { useAccount } from "@/lib/demo-account";
import {
  chatImageUrl,
  hideMessage,
  recentMessages,
  sendMessage,
  stopWatching,
  uploadChatImage,
  watchRoom,
  MAX_BODY,
  type ChatMessage,
} from "@/lib/chat";
import { btnGo, field } from "@/lib/ui";

/**
 * The lounge.
 *
 * Reading needs an account; posting needs an age-verified one. Both gates are
 * policies in 0022 - what this component does is explain which side of them
 * you are on, so an unverified guest is told why the box is closed instead of
 * watching a send silently fail.
 *
 * Realtime rather than polling: every insert pushes, and the handler re-reads
 * the last stretch rather than trying to splice the raw row in. The payload
 * from postgres_changes is the table row, without the handle or the picture,
 * and building a message two different ways is how the two drift apart.
 */

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: ChatMessage[] };

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ChatRoom() {
  const { ready, user } = useAccount();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<{ path: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);

  const alive = useRef(true);
  const foot = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const channel = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    const { rows, error } = await recentMessages();
    if (!alive.current) return;
    setLoad(error ? { kind: "error", message: error } : { kind: "ready", rows });
  }, []);

  // Only once there is a session: chat_recent() returns nothing without one,
  // and an empty room is the wrong thing to show somebody who is signed out.
  useEffect(() => {
    if (!ready || !user) return;
    void read();
    channel.current = watchRoom(() => void read());
    return () => {
      stopWatching(channel.current);
      channel.current = null;
    };
  }, [ready, user, read]);

  // Stay at the bottom as messages land, which is where a transcript is read.
  useEffect(() => {
    if (load.kind === "ready") {
      foot.current?.scrollIntoView({ block: "end" });
    }
  }, [load]);

  const attach = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setSaid(null);
    setBusy(true);
    const out = await uploadChatImage(file);
    if (!alive.current) return;
    setBusy(false);
    if (picker.current) picker.current.value = "";
    if (out.error || !out.path) {
      setSaid(out.error ?? "That did not upload.");
      return;
    }
    setPending({ path: out.path, url: chatImageUrl(out.path) ?? "" });
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || (!body.trim() && !pending)) return;
    setBusy(true);
    setSaid(null);

    const out = await sendMessage({ body, imagePath: pending?.path ?? null });
    if (!alive.current) return;
    setBusy(false);

    if (!out.ok) {
      setSaid(out.error ?? "That did not send.");
      return;
    }
    setBody("");
    setPending(null);
    void read();
  };

  if (!ready) {
    return <p className="label text-silverfaint uppercase">Checking…</p>;
  }

  if (!user) {
    return (
      <div className="border border-dashed border-line px-4 py-8 text-center">
        <p className="text-[0.9375rem] leading-relaxed text-silverdim">
          <Editable k="room.signedOut">Sign in to read the lounge.</Editable>
        </p>
        <Link href="/login" className={`${btnGo} mt-5`}>
          Sign in
        </Link>
      </div>
    );
  }

  // `verified` reads false until the profile row lands, so waiting on
  // profileLoaded is what stops the box telling a verified member they are not
  // one for the first moment of every visit.
  const canPost = user.profileLoaded && user.verified;
  const stillChecking = !user.profileLoaded;

  return (
    <div className="border border-line bg-ink">
      {/* ----------------------------------------------------- transcript -- */}
      <div className="h-[clamp(20rem,58vh,34rem)] overflow-y-auto px-4 py-4">
        {load.kind === "loading" && (
          <p className="label animate-pulse text-silverfaint uppercase">Loading…</p>
        )}

        {load.kind === "error" && (
          <p className="text-[0.875rem] leading-relaxed text-bloodhi" role="alert">
            {load.message}
          </p>
        )}

        {load.kind === "ready" && load.rows.length === 0 && (
          <p className="text-[0.9375rem] text-silverfaint">
            <Editable k="room.empty">Nobody has said anything yet.</Editable>
          </p>
        )}

        {load.kind === "ready" &&
          load.rows.map((m) => {
            const face = avatarUrl(m.avatarPath);
            const mine = m.userId === user.id;
            const picture = chatImageUrl(m.imagePath);
            return (
              <div key={m.id} className="group flex gap-3 py-2">
                {face ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={face}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="label flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-silverfaint">
                    {m.handle.slice(0, 1).toUpperCase()}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="label flex items-baseline gap-2 text-silverfaint">
                    <button
                      type="button"
                      onClick={() => setCard(m.handle)}
                      className="text-silver transition-colors hover:text-chalk hover:underline"
                    >
                      @{m.handle}
                    </button>
                    <span>{when(m.createdAt)}</span>
                    {mine && (
                      <button
                        type="button"
                        onClick={() => void hideMessage(m.id).then(() => read())}
                        className="ml-auto opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-bloodhi"
                      >
                        REMOVE
                      </button>
                    )}
                  </p>

                  {m.body && (
                    <p className="mt-0.5 text-[0.9375rem] leading-relaxed break-words text-chalk">
                      {m.body}
                    </p>
                  )}

                  {(picture || m.gifUrl) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={picture ?? m.gifUrl ?? ""}
                      alt=""
                      loading="lazy"
                      className="mt-2 max-h-64 w-auto max-w-full border border-line object-contain"
                    />
                  )}
                </div>
              </div>
            );
          })}

        <div ref={foot} />
      </div>

      {card && <MemberCard handle={card} onClose={() => setCard(null)} />}

      {/* ---------------------------------------------------------- box -- */}
      {canPost ? (
        <form onSubmit={send} className="border-t border-line p-3">
          {pending && (
            <div className="mb-2.5 flex items-center gap-3 border border-line p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pending.url} alt="" className="h-14 w-14 object-cover" />
              <span className="label flex-1 text-silverfaint">Attached</span>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="label px-2 text-silverfaint hover:text-bloodhi"
              >
                DROP
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_BODY}
              placeholder="Say something"
              aria-label="Message"
              className={`${field} min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={busy}
              aria-label="Attach a picture"
              className="label flex h-11 w-11 shrink-0 items-center justify-center border border-line text-silverdim transition-colors hover:border-linehi hover:text-chalk disabled:opacity-40"
            >
              +
            </button>
            <button
              type="submit"
              disabled={busy || (!body.trim() && !pending)}
              className={btnGo}
            >
              {busy ? "…" : "Send"}
            </button>
          </div>

          <input
            ref={picker}
            type="file"
            accept="image/*"
            onChange={(e) => void attach(e.target.files)}
            className="hidden"
          />

          {said && (
            <p className="mt-2 text-[0.8125rem] text-bloodhi" role="alert">
              {said}
            </p>
          )}
        </form>
      ) : stillChecking ? (
        <div className="border-t border-line p-4">
          <p className="label animate-pulse text-silverfaint uppercase">
            Checking your account…
          </p>
        </div>
      ) : (
        <div className="border-t border-line p-4">
          <p className="text-[0.875rem] leading-relaxed text-silverdim">
            <Editable k="room.needsVerify">
              You can read the lounge. Posting needs your age checked first.
            </Editable>
          </p>
          <Link
            href="/verify"
            className="label mt-2 inline-block text-silverdim underline transition-colors hover:text-chalk"
          >
            GET VERIFIED
          </Link>
        </div>
      )}
    </div>
  );
}
