"use client";

import { useState } from "react";
import Link from "next/link";
import { Editable } from "@/components/Editable";
import { org } from "@/lib/events";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * Sign in.
 *
 * Email and password. Supabase holds the password, hashed, and checks it
 * server side - nothing here ever sees or stores it, and it is not written to
 * component state beyond the life of the form.
 *
 * Signing in only. Making an account is /signup, which asks the same things
 * one screen at a time - this page used to do both from one form behind a
 * toggle, and a screen that quietly changes what the button does depending on
 * a link pressed above it is a screen people submit the wrong thing on.
 *
 * The shell is drawn in every state. When accounts are not connected, the
 * suggestions line and the admin link are the only reasons anyone is still on
 * this screen, so neither sits inside a branch a missing database can remove.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Supabase refuses anything shorter by default, so catching it here turns a
// round trip and a raw API message into an answer the moment they stop typing.
const MIN_PASSWORD = 6;

export default function Login() {
  const { ready, user, isAdmin, error, signInWithPassword, signOut } =
    useSupabaseAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Held apart from the hook's own error, which it rewrites on every call it
  // makes: the reason a submission was refused has to stay on screen long
  // enough to be read.
  const [problem, setProblem] = useState<string | null>(null);

  const connected = isSupabaseConfigured;
  const signedIn = Boolean(user);
  const emailOk = EMAIL.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const canSubmit = emailOk && passwordOk && !busy;
  const message = problem ?? (connected && !signedIn ? error : null);

  async function submit() {
    if (!canSubmit) return;

    setProblem(null);
    setBusy(true);

    const out = await signInWithPassword(email, password);

    setBusy(false);

    if (!out.ok) {
      setProblem(out.error ?? "That email and password were not accepted.");
      return;
    }

    // There is no state worth keeping a password in.
    setPassword("");
  }

  async function leave() {
    await signOut();
    setPassword("");
    setProblem(null);
  }

  return (
    <main className="mx-auto flex w-[92vw] max-w-[520px] flex-col items-center py-[clamp(3rem,10vw,6rem)] text-center">
      <span
        className={`label border px-3 py-2 ${
          connected
            ? "border-line text-silverfaint"
            : "border-[rgba(200,16,46,0.5)] text-bloodhi"
        }`}
      >
        {signedIn ? (
          <Editable k="login.badge.signedIn">SIGNED IN</Editable>
        ) : connected ? (
          <Editable k="login.badge.signIn">SIGN IN</Editable>
        ) : (
          <Editable k="login.badge.offline">NOT CONNECTED</Editable>
        )}
      </span>

      <h1 className="font-display chrome mt-7 text-[clamp(2.5rem,9vw,4rem)] leading-[0.85]">
        <Editable k="login.title">Accounts</Editable>
      </h1>

      {signedIn ? (
        <section className="mt-8 w-full text-left">
          <p className="label text-silverfaint">
            <Editable k="login.signedInAs">SIGNED IN AS</Editable>
          </p>
          <p className="mt-2 break-all text-chalk">{user?.email}</p>

          <div className="mt-6 flex flex-col gap-3">
            <Link href="/account" className={btnGo}>
              Your account
            </Link>

            {isAdmin && (
              <Link href="/admin" className={btn}>
                Admin dashboard
              </Link>
            )}

            <button type="button" onClick={leave} className={btn}>
              Sign out
            </button>
          </div>
        </section>
      ) : !ready ? (
        <p className="label mt-8 text-silverfaint">CHECKING&hellip;</p>
      ) : !connected ? (
        <p className="mt-6 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
          <Editable k="login.offline.body">
            Accounts are not connected in this build, so there is nothing to sign
            in to yet. Everything below still works.
          </Editable>
        </p>
      ) : (
        <form
          className="mt-8 w-full text-left"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="email" className="label text-silverfaint">
            <Editable k="login.emailLabel">EMAIL</Editable>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            className={`${field} mt-2 w-full`}
          />

          <label htmlFor="password" className="label mt-5 block text-silverfaint">
            <Editable k="login.passwordLabel">PASSWORD</Editable>
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(null);
            }}
            autoComplete="current-password"
            className={`${field} mt-2 w-full`}
          />

          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="label text-silverfaint">
              {password.length > 0 && !passwordOk
                ? `AT LEAST ${MIN_PASSWORD} CHARACTERS`
                : ""}
            </p>
            <Link
              href="/reset-password"
              className="label -my-3 shrink-0 py-3 text-silverdim underline decoration-line underline-offset-4 transition-colors hover:text-chalk hover:decoration-silverdim"
            >
              FORGOT PASSWORD?
            </Link>
          </div>

          {message && (
            <p className="label mt-3 text-bloodhi" role="alert">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`${btnGo} mt-6 w-full`}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="mt-9 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            <span className="label text-silverfaint">
              <Editable k="login.newHere">NEW HERE?</Editable>
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <Link
            href="/signup"
            className="font-display mt-4 flex min-h-12 w-full items-center justify-center border border-chalk bg-chalk px-[1.15rem] text-[1.0625rem] tracking-[0.12em] text-void uppercase transition-all hover:bg-white hover:shadow-[0_10px_34px_-12px_rgba(242,244,247,0.45)] active:scale-[0.98]"
          >
            Sign up
          </Link>
        </form>
      )}

      <p className="mt-8 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
        <Editable k="login.suggestions">Send suggestions to</Editable>{" "}
        <a
          href="https://www.instagram.com/stopaura/"
          target="_blank"
          rel="noopener"
          className="text-chalk underline decoration-line underline-offset-4 transition-colors hover:text-bloodhi hover:decoration-bloodhi"
        >
          @stopaura
        </a>
      </p>

      <Link
        href="/admin"
        className="label mt-3 text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk hover:decoration-silverdim"
      >
        ADMIN LOGIN
      </Link>

      <a
        href={org.instagram}
        target="_blank"
        rel="noopener"
        className={`${btnGo} mt-8 w-full`}
      >
        Follow {org.instagramHandle}
      </a>

      <Link href="/tickets" className={`${btn} mt-3 w-full`}>
        See the dates
      </Link>

      <Link
        href="/"
        className="label mt-7 text-silverfaint transition-colors hover:text-chalk"
      >
        &larr; BACK HOME
      </Link>
    </main>
  );
}
