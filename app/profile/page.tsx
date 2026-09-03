"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  avatarUrl,
  readOwnProfile,
  updateOwnProfile,
  uploadAvatar,
  type OwnProfile,
} from "@/lib/profile-data";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * The profile: a nickname and a picture, and everything else read-only.
 *
 * Only two fields are editable, and that is deliberate. `name` is written by
 * the ID check from what the licence actually says, so it is the legal one and
 * a door comparing a card against a screen needs it to stay that way - the
 * nickname sits above it as the name the site uses, without replacing it.
 * Email is the sign-in credential and changing it is an auth flow, not a text
 * field. Phone was asked at sign-up and nothing yet reads it back.
 */

type Load =
  | { kind: "loading" }
  | { kind: "ready"; profile: OwnProfile | null }
  | { kind: "error" };

type Save = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

export default function Profile() {
  const { ready, user } = useSupabaseAuth();

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [nickname, setNickname] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [save, setSave] = useState<Save>({ kind: "idle" });

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A blob URL is held until it is revoked, and the file behind it with it.
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readOwnProfile(userId).then((p) => {
      if (!live) return;
      setLoad(p ? { kind: "ready", profile: p } : { kind: "error" });
      if (p) {
        setNickname(p.nickname ?? "");
        setAvatarPath(p.avatarPath);
      }
    });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!ready) {
    return (
      <main className="mx-auto w-[92vw] max-w-[520px] py-[clamp(2.5rem,8vw,5rem)]">
        <p className="label text-silverfaint">CHECKING YOUR SESSION…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto w-[92vw] max-w-[460px] py-[clamp(3rem,10vw,6rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Not signed in
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {isSupabaseConfigured
            ? "Sign in to see and change your profile."
            : "Accounts are not connected in this build."}
        </p>
        {isSupabaseConfigured && (
          <Link href="/login" className={`${btnGo} mt-7 w-full`}>
            Go to sign in
          </Link>
        )}
      </main>
    );
  }

  const profile = load.kind === "ready" ? load.profile : null;
  const shown = pending ?? avatarUrl(avatarPath);
  const busy = save.kind === "saving";

  const choose = async (file: File | null) => {
    if (!file || !userId) return;
    setSave({ kind: "idle" });

    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(file);
    setPending(previewRef.current);

    setSave({ kind: "saving" });
    const up = await uploadAvatar(userId, file);
    if (!alive.current) return;

    if (up.error || !up.path) {
      setPending(null);
      return setSave({ kind: "failed", message: up.error ?? "That did not upload." });
    }

    // Saved against the row immediately rather than waiting for the Save
    // button: the picture is already in storage by this point, and leaving the
    // row pointing at the old one would mean an upload that silently did
    // nothing if they navigated away.
    const out = await updateOwnProfile(userId, { avatarPath: up.path });
    if (!alive.current) return;

    if (!out.ok) {
      setPending(null);
      return setSave({ kind: "failed", message: out.error ?? "That did not save." });
    }

    setAvatarPath(up.path);
    setPending(null);
    setSave({ kind: "saved" });
  };

  const submit = async () => {
    if (!userId) return;
    setSave({ kind: "saving" });
    const out = await updateOwnProfile(userId, { nickname: nickname.trim() });
    if (!alive.current) return;
    setSave(
      out.ok
        ? { kind: "saved" }
        : { kind: "failed", message: out.error ?? "That did not save." },
    );
  };

  return (
    <main className="mx-auto w-[92vw] max-w-[520px] py-[clamp(2.5rem,8vw,5rem)]">
      <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
        Your profile
      </h1>

      {load.kind === "loading" && (
        <p className="label mt-6 animate-pulse text-silverfaint">READING YOUR PROFILE…</p>
      )}

      {load.kind === "error" && (
        <p
          className="label mt-6 border border-[rgba(200,16,46,0.5)] p-3 leading-loose text-bloodhi"
          role="alert"
        >
          YOUR PROFILE DID NOT LOAD. WHAT IS BELOW IS BLANK BECAUSE NOTHING WAS
          READ, NOT BECAUSE NOTHING IS SET.
        </p>
      )}

      {/* --------------------------------------------------------- picture -- */}

      <section className="mt-8 flex items-center gap-5">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-linehi bg-ink">
          {shown ? (
            // A blob URL while it uploads, then a public one from storage.
            // next/image is no use for either, and the static export rules it
            // out regardless.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="Your profile picture" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-display text-[1.75rem] text-silverfaint">
                {(nickname || profile?.name || user.email)[0]?.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <label
            htmlFor="avatar"
            className={`${btn} inline-flex cursor-pointer px-4 py-2`}
          >
            {avatarPath ? "Change picture" : "Add a picture"}
          </label>
          <input
            id="avatar"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => void choose(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
          <p className="label mt-2 text-silverfaint">JPG OR PNG, UP TO 4 MB</p>
        </div>
      </section>

      {/* -------------------------------------------------------- nickname -- */}

      <div className="mt-8">
        <label htmlFor="nickname" className="label text-silverfaint">
          NICKNAME
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            setSave({ kind: "idle" });
          }}
          maxLength={40}
          placeholder="What people call you"
          disabled={busy}
          className={`${field} mt-2 w-full`}
        />
        <p className="label mt-2 leading-loose text-silverfaint">
          SHOWN INSTEAD OF YOUR NAME. THE NAME OFF YOUR ID STAYS ON YOUR TICKET
          SO THE DOOR CAN MATCH IT.
        </p>
      </div>

      {save.kind === "failed" && (
        <p
          className="label mt-5 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
          role="alert"
        >
          {save.message}
        </p>
      )}

      {save.kind === "saved" && (
        <p className="label mt-5 text-silverdim" role="status">
          SAVED.
        </p>
      )}

      <button
        onClick={() => void submit()}
        disabled={busy}
        className={`${btnGo} mt-6 w-full`}
      >
        {busy ? "Saving…" : "Save"}
      </button>

      {/* ------------------------------------------------------- read-only -- */}

      <dl className="mt-10 border-t border-line">
        {[
          ["NAME ON YOUR ID", profile?.name || "—"],
          ["EMAIL", user.email],
          ["PHONE", profile?.phone || "—"],
          ["INSTAGRAM", profile?.instagram ? `@${profile.instagram.replace(/^@/, "")}` : "—"],
        ].map(([k, v]) => (
          <div
            key={k}
            className="label flex items-baseline justify-between gap-4 border-b border-line py-3"
          >
            <dt className="text-silverfaint">{k}</dt>
            <dd className="text-right break-all text-chalk">{v}</dd>
          </div>
        ))}
        <div className="label flex items-baseline justify-between gap-4 border-b border-line py-3">
          <dt className="text-silverfaint">ID CHECK</dt>
          <dd className={profile?.verified ? "text-chalk" : "text-bloodhi"}>
            {profile?.verified ? "VERIFIED" : "NOT VERIFIED"}
          </dd>
        </div>
      </dl>

      <div className="mt-7 flex flex-col gap-3">
        {!profile?.verified && (
          <Link href="/verify" className={btnGo}>
            Verify your ID
          </Link>
        )}
        <Link href="/account" className={btn}>
          Your tickets
        </Link>
      </div>
    </main>
  );
}
