"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { atHandle, handleProblem } from "@/lib/handle";
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
 * The profile: a picture, a first name, an Instagram handle and a phone
 * number, and everything else read-only.
 *
 * The account's name is its Instagram handle. It is what goes on the ticket
 * and what the door reads off a screen, so there is no separate display name
 * to keep in step with it: changing the handle here renames the account, and
 * updateOwnProfile writes both columns in one go so they can never disagree.
 * That also means a handle is required - an account with no name is one the
 * door cannot find.
 *
 * Whether the guest is age-verified is decided by a person in the admin
 * dashboard reading the photo of the ID they sent, and by nothing else. The
 * row's `verified` cannot be written from a guest's session (the trigger in
 * 0011 refuses it), so this page only reports it, alongside where the newest
 * check stands: with us, refused with the reviewer's note, or never filed.
 * Email is the sign-in credential and changing it is an auth flow, not a text
 * field. Age is what was said at sign-up and the review is what checks it.
 */

type Load =
  | { kind: "loading" }
  | { kind: "ready"; profile: OwnProfile | null }
  | { kind: "error" };

type Save = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

/** Digits only, so +1 (212) 555-0139 and 2125550139 are the same answer. */
const digitsOf = (s: string) => s.replace(/\D/g, "");

export default function Profile() {
  const { ready, user } = useSupabaseAuth();

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [firstName, setFirstName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
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
        setFirstName(p.firstName ?? "");
        setInstagram(p.instagram ?? "");
        setPhone(p.phone ?? "");
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

  const check = profile?.latestCheck ?? null;
  const verified = Boolean(profile?.verified);
  // Verified wins outright: a check still on file from before an approval is
  // not "pending" once the row says cleared.
  const awaiting = !verified && check?.status === "pending";
  const refused = !verified && !awaiting && check?.status === "rejected";

  const accountName = profile?.instagram
    ? atHandle(profile.name)
    : profile?.name || "—";

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

    // Refused here, before the round trip, with the same words the sign-up
    // wizard uses - and refused at all because a blank handle would leave the
    // account with no name for the door to read.
    const wrong = handleProblem(instagram);
    if (wrong) return setSave({ kind: "failed", message: wrong });

    if (phone.trim() && digitsOf(phone).length < 10) {
      return setSave({
        kind: "failed",
        message: "That doesn't look like a full phone number. Leave it blank to remove it.",
      });
    }

    setSave({ kind: "saving" });

    // Two writes, not one. The handle and phone have existed since the first
    // migrations; first_name only exists once 0011 has run. A single UPDATE
    // naming both fails outright the moment PostgREST hits a column that is
    // not there, which used to mean a project that had not yet run 0011
    // could not save a handle either - two unrelated fields sharing one
    // failure. Sending first_name only when it actually changed, and as its
    // own request, means the handle and phone go through regardless.
    const core = await updateOwnProfile(userId, {
      instagram: instagram.trim(),
      phone: digitsOf(phone),
    });
    if (!alive.current) return;

    if (!core.ok) {
      return setSave({ kind: "failed", message: core.error ?? "That did not save." });
    }

    let nameError: string | undefined;
    if (firstName.trim() !== (profile?.firstName ?? "")) {
      const named = await updateOwnProfile(userId, { firstName: firstName.trim() });
      if (!alive.current) return;
      if (!named.ok) nameError = named.error ?? "The first name did not save.";
    }

    // Re-read rather than patched locally: the handle was normalised on the
    // way in, the name moved with it, and the read-only rows below should say
    // what the database now says, not what was typed. The fields follow the
    // fresh row too, so the box shows the handle the way it was stored.
    const fresh = await readOwnProfile(userId);
    if (!alive.current) return;
    if (fresh) {
      setLoad({ kind: "ready", profile: fresh });
      setFirstName(fresh.firstName ?? "");
      setInstagram(fresh.instagram ?? "");
      setPhone(fresh.phone ?? "");
      setAvatarPath(fresh.avatarPath);
    }
    // The handle and phone are what the door and the ticket actually depend
    // on, so their success is "saved" even when the first name - a courtesy
    // field - could not be written on a project still missing 0011.
    setSave(nameError ? { kind: "failed", message: nameError } : { kind: "saved" });
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
                {(profile?.name || firstName || user.email)[0]?.toUpperCase()}
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

      {/* ---------------------------------------------------------- fields -- */}

      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="firstName" className="label text-silverfaint">
          FIRST NAME
        </label>
        <input
          id="firstName"
          value={firstName}
          onChange={(e) => {
            setFirstName(e.target.value);
            setSave({ kind: "idle" });
          }}
          autoComplete="given-name"
          maxLength={40}
          placeholder="Jordan"
          disabled={busy}
          className={`${field} mt-2 w-full`}
        />

        <label htmlFor="instagram" className="label mt-6 block text-silverfaint">
          INSTAGRAM
        </label>
        <input
          id="instagram"
          value={instagram}
          onChange={(e) => {
            setInstagram(e.target.value);
            setSave({ kind: "idle" });
          }}
          autoComplete="off"
          autoCapitalize="none"
          placeholder="yourhandle"
          disabled={busy}
          className={`${field} mt-2 w-full`}
        />
        <p className="label mt-2 leading-loose text-silverfaint">
          YOUR ACCOUNT IS NAMED AFTER IT - IT&rsquo;S WHAT&rsquo;S ON YOUR
          TICKET AND WHAT THE DOOR READS.
        </p>

        <label htmlFor="phone" className="label mt-6 block text-silverfaint">
          PHONE (OPTIONAL)
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setSave({ kind: "idle" });
          }}
          autoComplete="tel"
          placeholder="(212) 555-0139"
          disabled={busy}
          className={`${field} mt-2 w-full`}
        />
        <p className="label mt-2 leading-loose text-silverfaint">
          ONLY USED IF SOMETHING CHANGES ON THE NIGHT.
        </p>

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

        <button type="submit" disabled={busy} className={`${btnGo} mt-6 w-full`}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>

      {/* ------------------------------------------------------- read-only -- */}

      <dl className="mt-10 border-t border-line">
        {[
          ["ACCOUNT NAME", accountName],
          ["EMAIL", user.email],
          ["AGE", profile?.age != null ? String(profile.age) : "—"],
        ].map(([k, v]) => (
          <div
            key={k}
            className="label flex items-baseline justify-between gap-4 border-b border-line py-3"
          >
            <dt className="text-silverfaint">{k}</dt>
            <dd className="text-right break-all text-chalk">{v}</dd>
          </div>
        ))}
        <div className="label border-b border-line py-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-silverfaint">AGE CHECK</dt>
            <dd
              className={
                verified ? "text-chalk" : awaiting ? "text-silverdim" : "text-bloodhi"
              }
            >
              {verified
                ? "VERIFIED"
                : awaiting
                  ? "PENDING"
                  : refused
                    ? "REFUSED"
                    : "NOT VERIFIED"}
            </dd>
          </div>
          {refused && check?.note && (
            // The reviewer's own words, so a guest sent back knows what to
            // send differently rather than guessing.
            <dd className="mt-2 text-right leading-loose text-silverdim">
              {check.note}
            </dd>
          )}
        </div>
      </dl>

      <div className="mt-7 flex flex-col gap-3">
        {!verified && !awaiting && (
          <Link href="/verify" className={btnGo}>
            Verify your age
          </Link>
        )}
        <Link href="/account" className={btn}>
          Your tickets
        </Link>
      </div>
    </main>
  );
}
