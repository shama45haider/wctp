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
 * Email only. There is no password field on this page and there is nowhere in
 * the stack to check one - the site is a static export, so a password would be
 * a box that asks for a secret nothing can verify. Supabase mails a single
 * message carrying both a link back to this page and a six-digit code; whether
 * the guest follows the link or types the digits, the browser ends up holding
 * the same session.
 *
 * The shell around the form is drawn in every state. When accounts are not
 * connected, the suggestions line and the admin link are the only reasons
 * anyone is still on this screen, so neither may sit inside a branch that a
 * missing database can take away.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

type Stage = "idle" | "sending" | "awaiting-code" | "verifying" | "signed-in";

export default function Login() {
  const { ready, user, isAdmin, error, signInWithEmail, verifyOtp, signOut } =
    useSupabaseAuth();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  // Which screen is up, tracked separately from the stage. Deriving it from
  // the stage instead would move the guest back to the email step for as long
  // as a second code was in flight, taking the code field with it.
  const [sent, setSent] = useState(false);
  // Held apart from the hook's own error: the hook rewrites its error on every
  // call it makes, and the reason a submission was refused has to stay on
  // screen long enough to be read.
  const [problem, setProblem] = useState<string | null>(null);

  const connected = isSupabaseConfigured;
  const busy = stage === "sending" || stage === "verifying";
  // An accepted code and a visible session are two different moments. Taking
  // the stage as well as the user means the screen does not fall back to the
  // form for a beat while the auth listener catches up.
  const signedIn = Boolean(user) || stage === "signed-in";
  const address = user?.email || email.trim();
  const emailOk = EMAIL.test(email.trim());
  // The hook says "not connected" for a build with no credentials, which the
  // prose below already says at more length. Anything else it reports - a host
  // that will not answer, a rejected send - belongs on screen.
  const message = problem ?? (connected && !signedIn ? error : null);

  async function requestCode() {
    if (!emailOk || busy) return;

    setProblem(null);
    setStage("sending");

    const out = await signInWithEmail(email);
    if (!out.ok) {
      setProblem(out.error ?? "The code could not be sent.");
      // A failed resend leaves the code screen exactly where it was; only a
      // first send that fails has an email step to fall back to.
      setStage(sent ? "awaiting-code" : "idle");
      return;
    }
    setSent(true);
    setStage("awaiting-code");
  }

  async function submitCode() {
    if (code.length < CODE_LENGTH || busy) return;

    setProblem(null);
    setStage("verifying");

    const out = await verifyOtp(email, code);
    if (!out.ok) {
      setProblem(out.error ?? "That code was not accepted.");
      setStage("awaiting-code");
      return;
    }
    setCode("");
    setStage("signed-in");
  }

  async function leave() {
    await signOut();
    startOver();
  }

  function startOver() {
    setCode("");
    setProblem(null);
    setSent(false);
    setStage("idle");
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
          <p className="mt-2 break-all text-chalk">{address}</p>

          {/* Stacked in a column rather than left inline: these controls are
              inline-flex, and side by side they would fight over one line. */}
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
      ) : sent ? (
        <form
          className="mt-8 w-full text-left"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
        >
          <label htmlFor="code" className="label text-silverfaint">
            SIX-DIGIT CODE
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            className={`${field} mt-2 w-full text-center tracking-[0.4em]`}
          />

          <p className="label mt-3 leading-loose text-silverfaint">
            SENT TO {address.toUpperCase()}. IT ARRIVES BY EMAIL AND CAN TAKE A
            MINUTE - CHECK SPAM. THE LINK IN THE SAME MESSAGE SIGNS YOU IN TOO.
          </p>

          {message && (
            <p className="label mt-3 text-bloodhi" role="alert">
              {message}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="submit"
              disabled={code.length < CODE_LENGTH || busy}
              className={btnGo}
            >
              {stage === "verifying" ? "Checking…" : "Sign in"}
            </button>

            <button
              type="button"
              onClick={() => void requestCode()}
              disabled={busy}
              className={btn}
            >
              {stage === "sending" ? "Sending…" : "Send another code"}
            </button>
          </div>

          <button
            type="button"
            onClick={startOver}
            className="label mt-5 w-full text-silverfaint transition-colors hover:text-chalk"
          >
            USE A DIFFERENT EMAIL
          </button>
        </form>
      ) : (
        <form
          className="mt-8 w-full text-left"
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
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

          <p className="label mt-3 leading-loose text-silverfaint">
            WE MAIL A SIX-DIGIT CODE AND A LINK THAT DOES THE SAME JOB. NO
            PASSWORD, EVER. THE MESSAGE CAN TAKE A MINUTE TO ARRIVE.
          </p>

          {message && (
            <p className="label mt-3 text-bloodhi" role="alert">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={!emailOk || busy}
            className={`${btnGo} mt-6 w-full`}
          >
            {stage === "sending" ? "Sending…" : "Email me a code"}
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
        className="font-display mt-8 flex min-h-11 w-full items-center justify-center border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] px-6 py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)]"
      >
        Follow {org.instagramHandle}
      </a>

      <Link
        href="/tickets"
        className="font-display mt-3 flex min-h-11 w-full items-center justify-center border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-6 py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim"
      >
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
