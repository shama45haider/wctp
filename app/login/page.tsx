"use client";

import { useState } from "react";
import Link from "next/link";
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
 * Setting a password is its own mode rather than a second page, because the
 * accounts that already exist were made by an emailed code and so have no
 * password at all. Whether a new one works immediately is the project's
 * setting and not this page's: with email confirmation on, Supabase issues no
 * session until the address is confirmed, and saying "you are in" at that
 * point would be a lie the guest cannot act on. So the copy below checks
 * whether a session actually appeared.
 *
 * The shell is drawn in every state. When accounts are not connected, the
 * suggestions line and the admin link are the only reasons anyone is still on
 * this screen, so neither sits inside a branch a missing database can remove.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Supabase refuses anything shorter by default, so catching it here turns a
// round trip and a raw API message into an answer the moment they stop typing.
const MIN_PASSWORD = 6;

type Mode = "sign-in" | "set-password";

export default function Login() {
  const {
    ready,
    user,
    isAdmin,
    error,
    signInWithPassword,
    signUpWithPassword,
    signOut,
  } = useSupabaseAuth();

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Held apart from the hook's own error, which it rewrites on every call it
  // makes: the reason a submission was refused has to stay on screen long
  // enough to be read.
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const connected = isSupabaseConfigured;
  const signedIn = Boolean(user);
  const emailOk = EMAIL.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const canSubmit = emailOk && passwordOk && !busy;
  const message = problem ?? (connected && !signedIn ? error : null);

  async function submit() {
    if (!canSubmit) return;

    setProblem(null);
    setNotice(null);
    setBusy(true);

    const out =
      mode === "sign-in"
        ? await signInWithPassword(email, password)
        : await signUpWithPassword(email, password);

    setBusy(false);

    if (!out.ok) {
      setProblem(
        out.error ??
          (mode === "sign-in"
            ? "That email and password were not accepted."
            : "The password could not be set."),
      );
      return;
    }

    // Clear it either way - there is no state worth keeping a password in.
    setPassword("");

    if (mode === "set-password") {
      // signUp resolving does not mean a session exists. With confirmation on,
      // Supabase has only sent an email, and the auth listener will not fire.
      setNotice(
        "Password set. If nothing happens, this project has email confirmation switched on - confirm the address, then sign in.",
      );
      setMode("sign-in");
    }
  }

  async function leave() {
    await signOut();
    setPassword("");
    setProblem(null);
    setNotice(null);
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
        {signedIn ? "SIGNED IN" : connected ? "SIGN IN" : "NOT CONNECTED"}
      </span>

      <h1 className="font-display chrome mt-7 text-[clamp(2.5rem,9vw,4rem)] leading-[0.85]">
        Accounts
      </h1>

      {signedIn ? (
        <section className="mt-8 w-full text-left">
          <p className="label text-silverfaint">SIGNED IN AS</p>
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
          Accounts are not connected in this build, so there is nothing to sign
          in to yet. Everything below still works.
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
            EMAIL
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
            PASSWORD
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(null);
            }}
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
            className={`${field} mt-2 w-full`}
          />

          {password.length > 0 && !passwordOk && (
            <p className="label mt-2 text-silverfaint">
              AT LEAST {MIN_PASSWORD} CHARACTERS
            </p>
          )}

          {notice && (
            <p className="label mt-3 leading-loose text-silverdim" role="status">
              {notice.toUpperCase()}
            </p>
          )}

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
            {busy
              ? mode === "sign-in"
                ? "Signing in…"
                : "Setting…"
              : mode === "sign-in"
                ? "Sign in"
                : "Set password"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "sign-in" ? "set-password" : "sign-in");
              setProblem(null);
              setNotice(null);
            }}
            className="label mt-5 w-full text-silverfaint transition-colors hover:text-chalk"
          >
            {mode === "sign-in"
              ? "NO PASSWORD YET? SET ONE"
              : "← BACK TO SIGNING IN"}
          </button>
        </form>
      )}

      <p className="mt-8 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
        Send suggestions to{" "}
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
