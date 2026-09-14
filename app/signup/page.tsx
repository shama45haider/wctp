"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { org } from "@/lib/events";
import { handleProblem, normalizeHandle } from "@/lib/handle";
import { requestSignupCode, verifySignupCode } from "@/lib/signup-code";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * Sign up, one question at a time - email and a code first, then everything
 * else.
 *
 * Built for a phone held in one hand at a bar, which is where most of these
 * actually happen: one field per screen, the keyboard already open on it, and
 * a thumb-sized button underneath.
 *
 * The account does not exist until the email does: submitting the email
 * sends a 6-digit code (request-signup-code), and only a correct code
 * (verify-signup-code) unlocks the rest of the form. handle_new_user() -
 * see supabase/migrations/0013_verify_email_before_signup.sql - checks for
 * that same proof again and refuses the insert outright if it is missing,
 * so the guarantee holds even against a call that skips this page entirely.
 * That is also why this is a real difference from Supabase's own "Confirm
 * email": that one creates the account first and asks afterward, which is
 * exactly the gap this closes.
 *
 * First name, age, Instagram handle and phone still go up as sign-up
 * metadata rather than being written afterwards, for the same reason as
 * before: handle_new_user reads them off the auth user, not a session, so
 * they survive whatever Supabase's own confirmation setting happens to be.
 *
 * The handle is the account's name: it goes on the ticket and it is what the
 * door reads off a screen, so it is asked for as itself and checked the way
 * Instagram would check it. No surname is asked anywhere. The age is what the
 * guest says it is - the age check, a person reading a photo of their ID
 * afterwards, is what decides whether they are cleared.
 *
 * The ID itself is still not one of these questions. Uploading a photo needs
 * a signed-in session to attach it to, and whether one exists the instant
 * signUp() resolves depends on whether Supabase's own "Confirm email" is
 * still switched on for this project - see the made screen below, which
 * reads that live rather than assuming either way. What this page does
 * regardless is make sure nobody mistakes the gap for a way out: the screen
 * after signing up offers exactly one button forward, straight into
 * /verify, and nothing to skip it with.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6}$/;
const MIN_PASSWORD = 6;
const MIN_AGE = 18;

/** Digits only, so +1 (212) 555-0139 and 2125550139 are the same answer. */
const digitsOf = (s: string) => s.replace(/\D/g, "");

type Answers = {
  email: string;
  code: string;
  firstName: string;
  age: string;
  instagram: string;
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
  autoCapitalize?: "none";
  inputMode?: "text" | "email" | "tel" | "numeric";
  pattern?: string;
  placeholder?: string;
  /** Null when the answer will do, otherwise what is wrong with it. */
  check: (value: string) => string | null;
};

const STEPS: Step[] = [
  {
    key: "email",
    label: "EMAIL",
    question: "What's your email?",
    hint: "We'll send a 6-digit code to make sure it's really yours before anything else.",
    type: "email",
    autoComplete: "email",
    inputMode: "email",
    placeholder: "you@example.com",
    check: (v) => (EMAIL.test(v.trim()) ? null : "That email doesn't look right."),
  },
  {
    key: "code",
    label: "CODE",
    question: "What's the code?",
    hint: "Check your inbox - it expires in 15 minutes.",
    type: "text",
    autoComplete: "one-time-code",
    inputMode: "numeric",
    pattern: "[0-9]*",
    placeholder: "123456",
    check: (v) => (CODE.test(v.trim()) ? null : "Enter the 6-digit code."),
  },
  {
    key: "firstName",
    label: "FIRST NAME",
    question: "What's your first name?",
    type: "text",
    autoComplete: "given-name",
    placeholder: "Jordan",
    check: (v) => (v.trim().length < 1 ? "Put in your first name." : null),
  },
  {
    key: "age",
    label: "AGE",
    question: "How old are you?",
    hint: `Our nights are ${MIN_AGE}+. This is what you tell us - the age check later reads it off your ID.`,
    type: "text",
    autoComplete: "off",
    inputMode: "numeric",
    pattern: "[0-9]*",
    placeholder: "21",
    check: (v) => {
      const s = v.trim();
      if (!/^\d+$/.test(s)) return "Put in your age as a whole number.";
      const n = Number(s);
      if (n < 1 || n > 120) return "That's not an age.";
      if (n < MIN_AGE) return `Our nights are ${MIN_AGE}+.`;
      return null;
    },
  },
  {
    key: "instagram",
    label: "INSTAGRAM",
    question: "What's your Instagram?",
    hint: "Your account is named after it - it's the name on your ticket and the name the door reads, so it has to be yours.",
    type: "text",
    autoComplete: "off",
    autoCapitalize: "none",
    placeholder: "@yourhandle",
    check: handleProblem,
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
    label: "PHONE NUMBER (OPTIONAL)",
    question: "And a phone number?",
    hint: "Only used if something changes on the night. Leave it blank if you'd rather not.",
    type: "tel",
    autoComplete: "tel",
    inputMode: "tel",
    placeholder: "(212) 555-0139",
    check: (v) => {
      if (v.trim() === "") return null;
      return digitsOf(v).length < 10
        ? "That doesn't look like a full number. Leave it blank to skip it."
        : null;
    },
  },
];

const EMAIL_STEP = STEPS.findIndex((s) => s.key === "email");

export default function SignUp() {
  const router = useRouter();
  const { ready, user, signUpWithPassword } = useSupabaseAuth();

  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    email: "",
    code: "",
    firstName: "",
    age: "",
    instagram: "",
    password: "",
    phone: "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  // A non-error confirmation, distinct from `problem` so "we sent it again"
  // does not paint itself in the same red as something going wrong.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The exact address a code has been confirmed for. Compared against the
  // live value on the email step so going back to look at it, then forward
  // again without changing anything, does not burn the code that already
  // worked and send a guest back to their inbox for no reason.
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
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
    setNotice(null);
    setAnswers((a) => ({ ...a, [step.key]: v }));
  };

  const back = () => {
    setProblem(null);
    setNotice(null);
    setAt((i) => Math.max(0, i - 1));
  };

  const resend = async () => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const out = await requestSignupCode(answers.email);
    setBusy(false);
    if (!out.ok) return setProblem(out.error ?? "Could not send a code.");
    setNotice("Sent again.");
  };

  const submit = async () => {
    // The Instagram step refused anything normalizeHandle would return null
    // for, so by the time this runs the handle is known to be one.
    const out = await signUpWithPassword(answers.email, answers.password, {
      firstName: answers.firstName.trim(),
      age: Number(answers.age.trim()),
      instagram: normalizeHandle(answers.instagram)!,
      phone: digitsOf(answers.phone) || undefined,
    });
    return out;
  };

  const next = async () => {
    const wrong = step.check(value);
    if (wrong) return setProblem(wrong);

    // The email step's job is not "is this shaped like an email" - check()
    // already did that - it is "send a code", and skip straight past the
    // code screen too when this exact address already has a live one.
    if (step.key === "email") {
      const clean = value.trim().toLowerCase();
      if (verifiedEmail === clean) {
        setAt((i) => i + 2);
        return;
      }
      setBusy(true);
      setProblem(null);
      setNotice(null);
      const out = await requestSignupCode(clean);
      setBusy(false);
      if (!out.ok) return setProblem(out.error ?? "Could not send a code.");
      setAt((i) => i + 1);
      return;
    }

    if (step.key === "code") {
      setBusy(true);
      setProblem(null);
      const out = await verifySignupCode(answers.email, value);
      setBusy(false);
      if (!out.ok) return setProblem(out.error ?? "That code is not right.");
      setVerifiedEmail(answers.email.trim().toLowerCase());
      setAt((i) => i + 1);
      return;
    }

    if (!last) {
      setAt((i) => i + 1);
      return;
    }

    setBusy(true);
    setProblem(null);
    const out = await submit();
    setBusy(false);

    if (!out.ok) {
      // The code proved the address is theirs, not that nobody has already
      // signed up with it - Supabase still checks that itself, here, same
      // as before this page asked for a code at all.
      if (/registered|already/i.test(out.error ?? "")) {
        setAt(EMAIL_STEP);
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
    // Live, not captured: whether a session lands the instant signUp
    // resolves depends on whether Supabase's own "Confirm email" is still
    // switched on for this project - this page's own code already proved
    // the address either way, so that setting is worth turning off, but
    // reading this live means the screen is still correct even until it is.
    const signedIn = Boolean(user);
    return (
      <main className="mx-auto w-[92vw] max-w-[460px] py-[clamp(3rem,10vw,6rem)]">
        <span className="label border border-line px-3 py-2 text-silverfaint">
          {signedIn ? "ONE LAST THING" : "CHECK YOUR EMAIL"}
        </span>

        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Verify your age
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {signedIn ? (
            <>
              Our nights are {MIN_AGE}+, and this is the one thing left before
              the account is any use. Send a photo of your ID and a person
              checks it by hand, which takes a little while. You&rsquo;ll hear
              back from <span className="break-all text-chalk">{org.email}</span>
              - nothing here RSVPs to anything until it&rsquo;s approved.
            </>
          ) : (
            "Your account is made. Confirm the address from the email we just sent, sign in, and the age check is the next thing you'll see."
          )}
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {signedIn ? (
            // No second button here on purpose - see the file's header
            // comment. An account with nothing left to skip to is worth
            // more than one more click saved today.
            <button onClick={() => router.push("/verify")} className={btnGo}>
              Verify my age
            </button>
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

  const buttonLabel = busy
    ? step.key === "email"
      ? "Sending…"
      : step.key === "code"
        ? "Checking…"
        : last
          ? "Making your account…"
          : "Working…"
    : step.key === "email"
      ? "Send code"
      : step.key === "code"
        ? "Verify"
        : last
          ? "Create account"
          : "Continue";

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
          {step.key === "code" ? (
            <>What&rsquo;s the code we sent {answers.email}?</>
          ) : (
            step.question
          )}
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
          pattern={step.pattern}
          autoComplete={step.autoComplete}
          autoCapitalize={step.autoCapitalize}
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
        {notice && !problem && (
          <p className="label mt-3 text-silverdim" role="status">
            {notice}
          </p>
        )}

        <button type="submit" disabled={busy} className={`${btnGo} mt-7 w-full`}>
          {buttonLabel}
        </button>

        {step.key === "code" && (
          <button
            type="button"
            onClick={() => void resend()}
            disabled={busy}
            className="label mt-4 w-full text-silverfaint transition-colors hover:text-chalk"
          >
            RESEND THE CODE
          </button>
        )}

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
