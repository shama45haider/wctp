"use client";

import { useState } from "react";
import Link from "next/link";
import { Editable } from "./Editable";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { addRequest, youtubeLinkProblem } from "@/lib/song-requests";
import { btnGo, field } from "@/lib/ui";

/**
 * Ask for a track.
 *
 * Closed to a single line until somebody wants it. An event page is already a
 * flyer, a date, a price and a ticket picker, and a permanently open two-field
 * form would be the loudest thing on it for something most visitors will never
 * use. It opens in place rather than in a dialog - the request is about the
 * night whose page it sits on, and losing that context to a modal is how you
 * end up asking "for which one?".
 *
 * `eventSlug` null means the request is not tied to a date - the version on
 * the account page, where "play this sometime" is the whole point.
 */
export default function SongRequestBox({
  eventSlug = null,
  eventTitle = null,
  onAdded,
}: {
  eventSlug?: string | null;
  eventTitle?: string | null;
  onAdded?: () => void;
}) {
  const { user } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const [song, setSong] = useState("");
  const [artist, setArtist] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ bad: boolean; text: string } | null>(null);

  const linkSays = link.trim() ? youtubeLinkProblem(link) : null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !song.trim()) return;

    setBusy(true);
    setSaid(null);
    const out = await addRequest({ song, artist, link, eventSlug, eventTitle });
    setBusy(false);

    if (!out.ok) {
      setSaid({ bad: true, text: out.error ?? "That did not send." });
      return;
    }
    setSong("");
    setArtist("");
    setLink("");
    setSaid({ bad: false, text: "Noted." });
    onAdded?.();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="label flex min-h-11 items-center gap-2 text-silverfaint transition-colors hover:text-chalk"
      >
        <span aria-hidden>♪</span>
        <Editable k="song.open">REQUEST A SONG</Editable>
      </button>
    );
  }

  if (!user) {
    return (
      <div className="border border-line bg-ink px-4 py-3.5">
        <p className="text-[0.875rem] leading-relaxed text-silverdim">
          <Editable k="song.signedOut">
            Sign in and we will know who asked.
          </Editable>
        </p>
        <Link
          href="/login"
          className="label mt-2 inline-block text-silverdim underline transition-colors hover:text-chalk"
        >
          SIGN IN
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="border border-line bg-ink px-4 py-3.5">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-0 flex-1">
          <label htmlFor="song" className="label text-silverfaint uppercase">
            <Editable k="song.track">Track</Editable>
          </label>
          <input
            id="song"
            value={song}
            onChange={(e) => setSong(e.target.value)}
            maxLength={120}
            placeholder="What are we playing?"
            className={`${field} mt-2 w-full`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="artist" className="label text-silverfaint uppercase">
            <Editable k="song.artist">Artist</Editable>
          </label>
          <input
            id="artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            maxLength={120}
            placeholder="Optional"
            className={`${field} mt-2 w-full`}
          />
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="songlink" className="label text-silverfaint uppercase">
          <Editable k="song.link">YouTube link</Editable>
        </label>
        <input
          id="songlink"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          inputMode="url"
          maxLength={400}
          aria-invalid={Boolean(linkSays)}
          placeholder="Optional — https://youtu.be/…"
          className={`${field} mt-2 w-full`}
        />
        {linkSays && (
          <p className="mt-2 text-[0.8125rem] text-bloodhi" role="alert">
            {linkSays}
          </p>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={busy || !song.trim() || Boolean(linkSays)}
          className={btnGo}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>

      {said && (
        <p
          className={`mt-3 text-[0.875rem] leading-relaxed ${
            said.bad ? "text-bloodhi" : "text-silverdim"
          }`}
          role={said.bad ? "alert" : "status"}
        >
          {said.text}
        </p>
      )}

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-silverfaint">
        <Editable k="song.note">
          Five per night. No promises, but we read every one.
        </Editable>
      </p>
    </form>
  );
}
