"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * Sign up, one question at a time.
 *
 * Built for a phone held in one hand at a bar, which is where most of these
 * actually happen: one field per screen, the keyboard already open on it, and
 * a thumb-sized button underneath. A single form with five stacked inputs is
 * faster to build and worse to fill in - on a small screen the keyboard covers
 * half of it, and every validation error appears somewhere the guest has to go
 * looking for.
 *
 * Name, email and phone go up as sign-up metadata rather than being written
 * afterwards. handle_new_user reads them when it creates the profile row, and
 * that trigger fires on the auth user rather than on a session - so they
 * survive email confirmation, which otherwise leaves no signed-in moment to
 * write them in and would mean asking twice.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

/** Digits only, so +1 (212) 555-0139 and 2125550139 are the same answer. */
const digitsOf = (s: string) => s.replace(/\D/g, "");

type Answers = {
  name: string;
  email: string;
  password: string;
  phone: string;
};

type Step = {
  key: keyof Answers;
  label: string;
  question: string;
  hint?: string;
  type: string;
  autoComplete: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  placeholder?: string;
  /** Null when the answer will do, otherwise what is wrong with it. */
  check: (value: string) => string | null;
};

const STEPS: Step[] = [
  {
    key: "name",
    label: "FULL NAME",
    question: "What's your name?",
    hint: "The one on the ID you'll bring. Door staff read both.",
    type: "text",
    autoComplete: "name",
    placeholder: "Jordan Lee",
    check: (v) =>
      v.trim().length < 2 ? "Put in the name you go by on your ID." : null,
  },
  {
    key: "email",
    label: "EMAIL",
    question: "What's your email?",
    hint: "Tickets and the address on the night go here.",
    type: "email",
    autoComplete: "email",
    inputMode: "email",
    placeholder: "you@example.com",
    check: (v) => (EMAIL.test(v.trim()) ? null : "That email doesn't look right."),
  },
  {
    key: "password",
    label: "PASSWORD",
    question: "Pick a password.",
    hint: "At least six characters. It's how you get back in.",
    type: "password",
    autoComplete: "new-password",
    check: (v) =>
      v.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : null,
  },
  {
    key: "phone",
    label: "PHONE NUMBER",
    question: "And a phone number?",
    hint: "Only used if something changes on the night.",
    type: "tel",
    autoComplete: "tel",
    inputMode: "tel",
    placeholder: "(212) 555-0139",
    check: (v) =>
      digitsOf(v).length < 10 ? "That doesn't look like a full number." : null,
  },
];

export default function SignUp() {
  const router = useRouter();
  const { ready, user, signUpWithPassword } = useSupabaseAuth();

  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    name: "",
    email: "",
    password: "",
    phone: "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once the account exists. Whether a session came with it is read live
  // below rather than captured here: signUp resolving and the auth listener
  // firing are two different moments, so asking at this one would show "check
  // your email" to somebody who was about to be signed in a tick later.
  const [made, setMade] = useState(false);

  const input = useRef<HTMLInputElement>(null);

  // The point of one field per screen is that it is already focused when the
  // screen arrives, keyboard and all. Without this a phone shows a question
  // and makes you tap the box under it.
  useEffect(() => {
    if (!made) input.current?.focus();
  }, [at, made]);

  const step = STEPS[at];
  const value = step ? answers[step.key] : "";
  const last = at === STEPS.length - 1;

  const set = (v: string) => {
    setProblem(null);
    setAnswers((a) => ({ ...a, [step.key]: v }));
  };

  const back = () => {
    setProblem(null);
    setAt((i) => Math.max(0, i - 1));
  };

  const submit = async () => {
    const out = await signUpWithPassword(answers.email, answers.password, {
      name: answers.name,
      phone: digitsOf(answers.phone),
    });
    return out;
  };

  const next = async () => {
    const wrong = step.check(value);
    if (wrong) return setProblem(wrong);

    if (!last) {
      setAt((i) => i + 1);
      return;
    }

    setBusy(true);
    setProblem(null);
    const out = await submit();
    setBusy(false);

    if (!out.ok) {
      // Sent back to the email screen when that is what was refused, since
      // "already registered" is the common one and the fix is up there.
      if (/registered|already/i.test(out.error ?? "")) {
        setAt(1);
        setProblem("There's already an account on that email. Sign in instead.");
        return;
      }
      setProblem(out.error ?? "That didn't go through.");
      return;
    }

    setMade(true);
  };

  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto w-[92vw] max-w-[460px] py-[clamp(3rem,10vw,6rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Sign up
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          Accounts are not connected in this build, so there is nothing to sign
          up to yet.
        </p>
        <Link href="/tickets" className={`${btnGo} mt-7 w-full`}>
          See the dates
        </Link>
      </main>
    );
  }

  if (ready && user && !made) {
    return (
      <main className="mx-auto w-[92vw] max-w-[460px] py-[clamp(3rem,10vw,6rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Already in
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          You&rsquo;re signed in as{" "}
          <span className="break-all text-chalk">{user.email}</span>.
        </p>
        <Link href="/account" className={`${btnGo} mt-7 w-full`}>
          Your account
        </Link>
      </main>
    );
  }

  // ------------------------------------------------------- the last screen --

  if (made) {
    // Live, not captured: with confirmation off a session lands moments after
    // signUp resolves, and this screen should follow it when it does.
    const signedIn = Boolean(user);
    return (
      <main className="mx-auto w-[92vw] max-w-[460px] py-[clamp(3rem,10vw,6rem)]">
        <span className="label border border-line px-3 py-2 text-silverfaint">
          {signedIn ? "ONE LAST THING" : "CHECK YOUR EMAIL"}
        </span>

        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Verify ID
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {signedIn
            ? "Our nights are 18+. Scan the back of your licence and it's done in a second - or send another ID and we'll check it by hand."
            : "Your account is made. Confirm the address from the email we just sent, sign in, and the ID check is the last step."}
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {signedIn ? (
            <>
              <button onClick={() => router.push("/verify")} className={btnGo}>
                Verify my ID
              </button>
              <Link href="/tickets" className={btn}>
                Later - show me the dates
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={btnGo}>
                Go to sign in
              </Link>
              <Link href="/tickets" className={btn}>
                See the dates
              </Link>
            </>
          )}
        </div>
      </main>
    );
  }

  // ------------------------------------------------------------ the slides --

  return (
    <main className="mx-auto flex w-[92vw] max-w-[460px] flex-col py-[clamp(2.5rem,8vw,5rem)]">
      <div className="flex items-center justify-between gap-4">
        <span className="label text-silverfaint">
          {at + 1} / {STEPS.length}
        </span>
        <Link href="/login" className="label text-silverfaint hover:text-chalk">
          I HAVE AN ACCOUNT
        </Link>
      </div>

      {/* One filled bar per answered question, so progress is legible at a
          glance rather than only as a fraction. */}
      <div className="mt-3 flex gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span
            key={s.key}
            className={`h-0.5 flex-1 transition-colors ${
              i <= at ? "bg-bloodhi" : "bg-line"
            }`}
          />
        ))}
      </div>

      <form
        className="mt-9"
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
      >
        <label htmlFor={step.key} className="label text-silverfaint">
          {step.label}
        </label>

        <h1 className="font-display chrome mt-2 text-[clamp(1.75rem,7vw,2.5rem)] leading-[0.95]">
          {step.question}
        </h1>

        {step.hint && (
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            {step.hint}
          </p>
        )}

        <input
          ref={input}
          id={step.key}
          name={step.key}
          type={step.type}
          inputMode={step.inputMode}
          autoComplete={step.autoComplete}
          placeholder={step.placeholder}
          value={value}
          onChange={(e) => set(e.target.value)}
          disabled={busy}
          className={`${field} mt-6 w-full text-[1.0625rem]`}
        />

        {problem && (
          <p className="label mt-3 text-bloodhi" role="alert">
            {problem}
          </p>
        )}

        <button type="submit" disabled={busy} className={`${btnGo} mt-7 w-full`}>
          {busy ? "Making your account…" : last ? "Create account" : "Continue"}
        </button>

        {at > 0 && (
          <button
            type="button"
            onClick={back}
            disabled={busy}
            className="label mt-4 w-full text-silverfaint transition-colors hover:text-chalk"
          >
            &larr; BACK
          </button>
        )}
      </form>
    </main>
  );
}
