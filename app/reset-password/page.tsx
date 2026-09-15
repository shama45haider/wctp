"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Editable } from "@/components/Editable";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * Forgot password, in two halves on one page.
 *
 * Arriving plain, it asks for an email and sends Supabase's reset link, which
 * points back here. Arriving through that link, the URL carries a code the
 * Supabase client exchanges for a short-lived session on its own
 * (detectSessionInUrl in lib/supabase.ts) - once that session exists, this is
 * the new-password form. A link from a customised email template carrying
 * token_hash is verified here directly instead.
 *
 * The URL is captured when this module loads, before the client strips the
 * code out of the address bar, so the page still knows it came from a link.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

const ARRIVED_WITH = typeof window === "undefined" ? "" : `${window.location.search}&${window.location.hash.slice(1)}`;

type Mode = "checking" | "request" | "sent" | "set" | "done";

export default function ResetPassword() {
  const { sendPasswordReset, setNewPassword } = useSupabaseAuth();

  const [mode, setMode] = useState<Mode>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Works out which half to show. Every state change happens after an await,
  // never directly in the effect body.
  useEffect(() => {
    let live = true;
    void (async () => {
      const params = new URLSearchParams(ARRIVED_WITH);
      const supabase = isSupabaseConfigured ? getSupabase() : null;
      let next: Mode = "request";
      let why: string | null = null;

      if (params.get("error_description") || params.get("error")) {
        why = "That reset link has expired or was already used. Ask for a new one below.";
      } else if (supabase && params.get("token_hash") && params.get("type") === "recovery") {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: params.get("token_hash") ?? "",
          type: "recovery",
        });
        if (error) why = "That reset link has expired or was already used. Ask for a new one below.";
        else next = "set";
      } else if (supabase && params.get("code")) {
        // getSession waits for the client to finish exchanging the code.
        const { data } = await supabase.auth.getSession();
        if (data.session) next = "set";
        else
          why =
            "That link couldn't be used here. Open it in the same browser you asked for it from, or ask for a new one below.";
      } else {
        await Promise.resolve();
      }

      if (!live) return;
      setProblem(why);
      setMode(next);
    })();
    return () => {
      live = false;
    };
  }, []);

  async function request() {
    if (!EMAIL.test(email.trim()) || busy) return;
    setBusy(true);
    setProblem(null);
    const out = await sendPasswordReset(email);
    setBusy(false);
    if (!out.ok) {
      setProblem(out.error ?? "The reset email didn't send. Try again in a minute.");
      return;
    }
    setMode("sent");
  }

  async function save() {
    if (password.length < MIN_PASSWORD || password !== confirm || busy) return;
    setBusy(true);
    setProblem(null);
    const out = await setNewPassword(password);
    setBusy(false);
    if (!out.ok) {
      setProblem(out.error ?? "That password wasn't saved.");
      return;
    }
    setPassword("");
    setConfirm("");
    setMode("done");
  }

  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <main className="mx-auto flex w-[92vw] max-w-[520px] flex-col items-center py-[clamp(3rem,10vw,6rem)] text-center">
      <span className="label border border-line px-3 py-2 text-silverfaint">
        <Editable k="reset.badge">PASSWORD RESET</Editable>
      </span>

      <h1 className="font-display chrome mt-7 text-[clamp(2.25rem,8vw,3.5rem)] leading-[0.85]">
        {mode === "set" ? (
          <Editable k="reset.set.title">New password</Editable>
        ) : mode === "done" ? (
          <Editable k="reset.done.title">You&rsquo;re back in</Editable>
        ) : (
          <Editable k="reset.request.title">Forgot password</Editable>
        )}
      </h1>

      {!isSupabaseConfigured ? (
        <p className="mt-6 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
          <Editable k="reset.offline">Accounts are not connected in this build.</Editable>
        </p>
      ) : mode === "checking" ? (
        <p className="label mt-8 text-silverfaint">CHECKING&hellip;</p>
      ) : mode === "sent" ? (
        <section className="mt-8 w-full text-left">
          <p className="text-[0.9375rem] leading-relaxed text-silverdim">
            <Editable k="reset.sent.body">
              If an account uses that email, a reset link is on its way. Open it on this device, in this
              browser - it can take a minute, so check spam too.
            </Editable>
          </p>
          <button type="button" onClick={() => setMode("request")} className={`${btn} mt-6 w-full`}>
            Use a different email
          </button>
        </section>
      ) : mode === "done" ? (
        <section className="mt-8 w-full text-left">
          <p className="text-[0.9375rem] leading-relaxed text-silverdim">
            <Editable k="reset.done.body">Your new password is saved and you&rsquo;re signed in.</Editable>
          </p>
          <Link href="/account" className={`${btnGo} mt-6 w-full`}>
            Your account
          </Link>
        </section>
      ) : mode === "set" ? (
        <form
          className="mt-8 w-full text-left"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="new-password" className="label text-silverfaint">
            <Editable k="reset.set.passwordLabel">NEW PASSWORD</Editable>
          </label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(null);
            }}
            autoComplete="new-password"
            className={`${field} mt-2 w-full`}
          />
          {password.length > 0 && password.length < MIN_PASSWORD && (
            <p className="label mt-2 text-silverfaint">AT LEAST {MIN_PASSWORD} CHARACTERS</p>
          )}

          <label htmlFor="confirm-password" className="label mt-5 block text-silverfaint">
            <Editable k="reset.set.confirmLabel">TYPE IT AGAIN</Editable>
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setProblem(null);
            }}
            autoComplete="new-password"
            className={`${field} mt-2 w-full`}
          />
          {mismatch && <p className="label mt-2 text-bloodhi">THOSE DON&rsquo;T MATCH</p>}

          {problem && (
            <p className="label mt-3 text-bloodhi" role="alert">
              {problem}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || password.length < MIN_PASSWORD || password !== confirm}
            className={`${btnGo} mt-6 w-full`}
          >
            {busy ? "Saving…" : "Save new password"}
          </button>
        </form>
      ) : (
        <form
          className="mt-8 w-full text-left"
          onSubmit={(e) => {
            e.preventDefault();
            void request();
          }}
        >
          <p className="text-[0.9375rem] leading-relaxed text-silverdim">
            <Editable k="reset.request.body">
              Put in the email you signed up with and we&rsquo;ll send a link to set a new password.
            </Editable>
          </p>

          <label htmlFor="reset-email" className="label mt-6 block text-silverfaint">
            <Editable k="reset.request.emailLabel">EMAIL</Editable>
          </label>
          <input
            id="reset-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setProblem(null);
            }}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            className={`${field} mt-2 w-full`}
          />

          {problem && (
            <p className="label mt-3 text-bloodhi" role="alert">
              {problem}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !EMAIL.test(email.trim())}
            className={`${btnGo} mt-6 w-full`}
          >
            {busy ? "Sending…" : "Email me a reset link"}
          </button>
        </form>
      )}

      <Link href="/login" className="label mt-8 text-silverfaint transition-colors hover:text-chalk">
        &larr; BACK TO SIGN IN
      </Link>
    </main>
  );
}
