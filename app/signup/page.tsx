"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { org } from "@/lib/events";
import { handleProblem, normalizeHandle } from "@/lib/handle";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * Sign up, one question at a time.
 *
 * Built for a phone held in one hand at a bar, which is where most of these
 * actually happen: one field per screen, the keyboard already open on it, and
 * a thumb-sized button underneath. A single form with six stacked inputs is
 * faster to build and worse to fill in - on a small screen the keyboard covers
 * half of it, and every validation error appears somewhere the guest has to go
 * looking for.
 *
 * First name, age, Instagram handle and phone go up as sign-up metadata rather
 * than being written afterwards. handle_new_user reads them when it creates
 * the profile row, and that trigger fires on the auth user rather than on a
 * session - so they survive email confirmation, which otherwise leaves no
 * signed-in moment to write them in and would mean asking twice.
 *
 * The handle is the account's name: it goes on the ticket and it is what the
 * door reads off a screen, so it is asked for as itself and checked the way
 * Instagram would check it. No surname is asked anywhere. The age is what the
 * guest says it is - the age check, a person reading a photo of their ID
 * afterwards, is what decides whether they are cleared.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
const MIN_AGE = 18;

/** Digits only, so +1 (212) 555-0139 and 2125550139 are the same answer. */
const digitsOf = (s: string) => s.replace(/\D/g, "");

type Answers = {
  firstName: string;
  age: string;
  instagram: string;
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
  autoCapitalize?: "none";
  inputMode?: "text" | "email" | "tel" | "numeric";
  pattern?: string;
  placeholder?: string;
  /** Null when the answer will do, otherwise what is wrong with it. */
  check: (value: string) => string | null;
};

const STEPS: Step[] = [
  {
    key: "firstName",
    label: "FIRST NAME",
    question: "What's your first name?",
    hint: "Just the first. Nobody here asks for a surname.",
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
    firstName: "",
    age: "",
    instagram: "",
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
    // Live, not captured: with confirmation off a session lands moments after
    // signUp resolves, and this screen should follow it when it does.
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
              Our nights are {MIN_AGE}+. Send a photo of your ID and a person
              checks it by hand, which takes a little while. You&rsquo;ll hear
              back from <span className="break-all text-chalk">{org.email}</span>,
              and you can&rsquo;t RSVP until it&rsquo;s approved.
            </>
          ) : (
            "Your account is made. Confirm the address from the email we just sent, sign in, and the age check is the last step."
          )}
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {signedIn ? (
            <>
              <button onClick={() => router.push("/verify")} className={btnGo}>
                Verify my age
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
