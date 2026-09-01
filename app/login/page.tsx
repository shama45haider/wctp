"use client";

import { useState } from "react";
import Link from "next/link";

type Mode = "login" | "signup";

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const isSignup = mode === "signup";

  return (
    <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(2.5rem,7vw,5rem)]">
      <h1 className="font-display chrome text-[clamp(2.25rem,7vw,3.5rem)] leading-[0.85]">
        {isSignup ? "Get on the list" : "Welcome back"}
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        {isSignup
          ? "One account to RSVP, hold your spot and get locations when they drop."
          : "Sign in to see your RSVPs and the addresses you've been cleared for."}
      </p>

      <div className="mt-8 flex border border-line">
        {(["login", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`label flex-1 py-3 transition-colors ${
              mode === m
                ? "bg-ink2 text-chalk"
                : "text-silverfaint hover:text-silver"
            }`}
          >
            {m === "login" ? "LOGIN" : "SIGN UP"}
          </button>
        ))}
      </div>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        {isSignup && (
          <div className="mb-4 flex flex-col gap-2">
            <label htmlFor="l-name" className="label text-silverfaint">
              NAME
            </label>
            <input
              id="l-name"
              type="text"
              placeholder="Who are you?"
              className="border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none"
            />
          </div>
        )}

        <div className="mb-4 flex flex-col gap-2">
          <label htmlFor="l-email" className="label text-silverfaint">
            EMAIL
          </label>
          <input
            id="l-email"
            type="email"
            placeholder="you@domain.com"
            className="border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none"
          />
        </div>

        <div className="mb-6 flex flex-col gap-2">
          <label htmlFor="l-pass" className="label text-silverfaint">
            PASSWORD
          </label>
          <input
            id="l-pass"
            type="password"
            placeholder="••••••••"
            className="border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled
          className="font-display w-full cursor-not-allowed border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase opacity-60"
        >
          {isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <div className="label mt-6 border border-dashed border-linehi p-4 leading-loose text-silverfaint">
        MOCKUP &mdash; this form is intentionally inert. Nothing is sent, stored
        or validated until Supabase auth is wired up.
      </div>

      <Link
        href="/#events"
        className="label mt-6 inline-block text-silverfaint hover:text-chalk"
      >
        &larr; BACK TO EVENTS
      </Link>
    </main>
  );
}
