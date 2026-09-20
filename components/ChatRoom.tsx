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
  announce,
  announceTyping,
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
  const [live, setLive] = useState(false);
  /** Your own message, shown before the server has confirmed it. */
  const [sending, setSending] = useState<string | null>(null);
  const [typing, setTyping] = useState(0);
  const [behind, setBehind] = useState(false);

  const alive = useRef(true);
  const foot = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** Whether the reader was at the bottom before this batch arrived. */
  const wasAtBottom = useRef(true);
  const coalesce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typers = useRef(new Map<string, number>());
  const lastTypedAt = useRef(0);
  /**
   * Stable per tab, meaningless off it, only ever counted and never shown.
   * Filled on mount rather than inline: generating it during render is an
   * impure call, and nothing reads it until an event fires anyway.
   */
  const myKey = useRef("");

  useEffect(() => {
    alive.current = true;
    if (!myKey.current) myKey.current = crypto.randomUUID();
    return () => {
      alive.current = false;
    };
  }, []);

  const atBottom = () => {
    const el = scroller.current;
    if (!el) return true;
    // Within a line and a half of the end counts as "following along".
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const read = useCallback(async () => {
    wasAtBottom.current = atBottom();
    const { rows, error } = await recentMessages();
    if (!alive.current) return;
    setLoad(error ? { kind: "error", message: error } : { kind: "ready", rows });
    // The authoritative list has landed, so the optimistic copy has either
    // arrived in it or failed; either way it stops being shown twice.
    setSending(null);
  }, []);

  /**
   * One read per burst.
   *
   * Five people posting at once is five broadcasts, and re-reading the whole
   * room five times in a tick is wasted work that also makes the list flicker.
   */
  const readSoon = useCallback(() => {
    if (coalesce.current) clearTimeout(coalesce.current);
    coalesce.current = setTimeout(() => void read(), 90);
  }, [read]);

  // Only once there is a session: chat_recent() returns nothing without one,
  // and an empty room is the wrong thing to show somebody who is signed out.
  useEffect(() => {
    if (!ready || !user) return;
    void read();
    let dead = false;
    void (async () => {
      const ch = await watchRoom(
        () => readSoon(),
        (ok) => setLive(ok),
        (who) => {
          if (who === myKey.current) return;
          typers.current.set(who, Date.now());
          setTyping(typers.current.size);
        },
      );
      // Unmounted while the session lookup was in flight: close it rather than
      // leaving a subscribed channel behind with nothing listening.
      if (dead) {
        stopWatching(ch);
        return;
      }
      channel.current = ch;
    })();

    /**
     * A slow backstop, running whether or not realtime says it is connected.
     *
     * Gating this on the subscription status would not have caught the fault
     * that made it necessary: with the table missing from the publication the
     * channel reported SUBSCRIBED and delivered nothing, so a status-gated
     * poll would have stayed asleep while the room sat frozen. Twenty-five
     * Eight seconds, not the twenty-five it started at: at twenty-five anyone
     * waiting on a reply refreshes long before it fires, so the backstop might
     * as well not have been there. This is insurance behind broadcast, not the
     * way messages are meant to arrive.
     *
     * Slowed right down when the tab is hidden, the way the raffle page does -
     * nobody is reading a chat they cannot see.
     */
    const tick = window.setInterval(
      () => {
        if (document.hidden) return;
        void read();
      },
      8_000,
    );

    // Nobody sends a "stopped typing"; an entry simply goes stale.
    const sweep = window.setInterval(() => {
      const cutoff = Date.now() - 4000;
      let changed = false;
      for (const [k, at] of typers.current) {
        if (at < cutoff) {
          typers.current.delete(k);
          changed = true;
        }
      }
      if (changed) setTyping(typers.current.size);
    }, 1500);

    return () => {
      dead = true;
      window.clearInterval(sweep);
      if (coalesce.current) clearTimeout(coalesce.current);
      window.clearInterval(tick);
      stopWatching(channel.current);
      channel.current = null;
      setLive(false);
    };
  }, [ready, user, read, readSoon]);

  /**
   * Follow the bottom, but only for somebody who was already there.
   *
   * This used to scroll on every load, including the backstop poll - so
   * anyone reading back through the night got dragged to the newest message
   * every eight seconds. Instagram does not do that, and neither should this:
   * if you have scrolled up, you stay where you are and a button appears.
   */
  useEffect(() => {
    if (load.kind !== "ready") return;
    if (wasAtBottom.current) {
      foot.current?.scrollIntoView({ block: "end" });
      setBehind(false);
    } else {
      setBehind(true);
    }
  }, [load, sending]);

  const jumpDown = () => {
    foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setBehind(false);
  };

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

    // Shown before the round trip finishes. It is your own text, so there is
    // nothing to verify - and waiting two network hops to see what you just
    // typed is the single thing that makes a chat feel slow.
    const mine = body.trim();
    wasAtBottom.current = true;
    setSending(mine || "📷");
    setBody("");

    const out = await sendMessage({ body: mine, imagePath: pending?.path ?? null });
    if (!alive.current) return;
    setBusy(false);

    if (!out.ok) {
      // Put it back in the box rather than losing what they wrote.
      setSending(null);
      setBody(mine);
      setSaid(out.error ?? "That did not send.");
      return;
    }
    setPending(null);
    void read();
    announce(channel.current);
  };

  /**
   * Tell the room, at most once every two seconds.
   *
   * A broadcast per keystroke is a lot of traffic for an indicator nobody
   * reads closely, and the receiving side treats anything within four seconds
   * as still typing.
   */
  const onTyped = (next: string) => {
    setBody(next);
    const now = Date.now();
    if (next && now - lastTypedAt.current > 2000) {
      lastTypedAt.current = now;
      announceTyping(channel.current, myKey.current);
    }
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
      <div className="label flex items-center justify-between border-b border-linesoft px-4 py-2 text-silverfaint">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              live ? "bg-bloodhi" : "bg-linehi"
            }`}
          />
          {live ? "LIVE" : "CATCHING UP"}
        </span>
      </div>

      {/* ----------------------------------------------------- transcript -- */}
      <div
        ref={scroller}
        onScroll={() => {
          if (atBottom()) setBehind(false);
        }}
        className="relative h-[clamp(20rem,58vh,34rem)] overflow-y-auto px-4 py-4"
      >
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
                        onClick={() =>
                          void hideMessage(m.id).then(() => {
                            void read();
                            announce(channel.current);
                          })
                        }
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

        {sending && (
          <div className="flex gap-3 py-2 opacity-55">
            <span className="label flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-silverfaint">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="label flex items-baseline gap-2 text-silverfaint">
                <span className="text-silver">@{user.name}</span>
                <span>SENDING…</span>
              </p>
              <p className="mt-0.5 text-[0.9375rem] leading-relaxed break-words text-chalk">
                {sending}
              </p>
            </div>
          </div>
        )}

        <div ref={foot} />
      </div>

      {card && <MemberCard handle={card} onClose={() => setCard(null)} />}

      {behind && (
        <button
          type="button"
          onClick={jumpDown}
          className="label w-full border-t border-linesoft bg-ink2 py-2 text-center text-silverdim transition-colors hover:text-chalk"
        >
          NEW MESSAGES ↓
        </button>
      )}

      {typing > 0 && (
        <p
          aria-live="polite"
          className="label border-t border-linesoft px-4 py-1.5 text-silverfaint"
        >
          {typing === 1 ? "Someone is typing…" : `${typing} people are typing…`}
        </p>
      )}

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
              onChange={(e) => onTyped(e.target.value)}
              maxLength={MAX_BODY}
              placeholder="Say something"
              aria-label="Message"
              autoComplete="off"
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
