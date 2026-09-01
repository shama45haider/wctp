"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/demo-account";

type Mode = "login" | "signup";

const field =
  "border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none";

export default function Login() {
  const router = useRouter();
  const { ready, user, cart, signUp, signIn, signInAsDemo, signOut } =
    useAccount();

  // Signing in is usually a detour out of a half-built order. Land back on it
  // rather than on the account page, which would look like the order vanished.
  const resume = cart ? "/checkout" : "/account";

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [instagram, setInstagram] = useState("");
  const isSignup = mode === "signup";

  if (ready && user) {
    return (
      <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(2.5rem,7vw,5rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,6vw,3rem)] leading-[0.85]">
          {user.name}
        </h1>
        <p className="label mt-3 text-silverdim">{user.email.toUpperCase()}</p>
        <div className="label mt-6 flex items-center justify-between border border-line px-3 py-3">
          <span className="text-silverfaint">ID STATUS</span>
          <span className={user.verified ? "text-bloodhi" : "text-silverdim"}>
            {user.verified ? "VERIFIED" : "NOT VERIFIED"}
          </span>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          {cart && user.verified && (
            <Link
              href="/checkout"
              className="font-display border border-[rgba(200,16,46,0.5)] py-3 text-center tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
            >
              Resume checkout
            </Link>
          )}
          {!user.verified && (
            <Link
              href="/verify"
              className="font-display border border-[rgba(200,16,46,0.5)] py-3 text-center tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
            >
              Verify your ID
            </Link>
          )}
          <Link
            href="/account"
            className="font-display border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 text-center tracking-[0.12em] text-chalk uppercase hover:border-silverdim"
          >
            My tickets
          </Link>
          <button
            onClick={signOut}
            className="label py-2 text-silverfaint transition-colors hover:text-chalk"
          >
            SIGN OUT
          </button>
        </div>
      </main>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    if (isSignup) {
      signUp({ name: name || email.split("@")[0], email, instagram });
      router.push("/verify");
    } else {
      signIn(email);
      router.push(resume);
    }
  };

  return (
    <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(2.5rem,7vw,5rem)]">
      <h1 className="font-display chrome text-[clamp(2.25rem,7vw,3.5rem)] leading-[0.85]">
        {isSignup ? "Get on the list" : "Welcome back"}
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        {isSignup
          ? "One account to RSVP, hold your spot and get locations when they drop."
          : "Sign in to see your tickets and the addresses you've been cleared for."}
      </p>

      <button
        onClick={() => {
          signInAsDemo();
          router.push(resume);
        }}
        className="font-display mt-7 w-full border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim"
      >
        Explore as demo guest
      </button>
      <p className="label mt-2 text-center text-silverfaint">
        PRE-VERIFIED ACCOUNT · NO SIGN-UP NEEDED
      </p>

      <div className="my-7 flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <span className="label text-silverfaint">OR</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="flex border border-line">
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

      <form className="mt-6" onSubmit={submit}>
        {isSignup && (
          <>
            <div className="mb-4 flex flex-col gap-2">
              <label htmlFor="l-name" className="label text-silverfaint">
                NAME
              </label>
              <input
                id="l-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who are you?"
                className={field}
              />
            </div>
            <div className="mb-4 flex flex-col gap-2">
              <label htmlFor="l-ig" className="label text-silverfaint">
                INSTAGRAM
              </label>
              <input
                id="l-ig"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="@yourhandle"
                className={field}
              />
            </div>
          </>
        )}

        <div className="mb-4 flex flex-col gap-2">
          <label htmlFor="l-email" className="label text-silverfaint">
            EMAIL
          </label>
          <input
            id="l-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com"
            className={field}
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
            className={field}
          />
        </div>

        <button
          type="submit"
          className="font-display w-full border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)]"
        >
          {isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="label mt-5 text-center text-silverfaint">
        {isSignup
          ? "NEXT STEP: A QUICK 18+ ID CHECK"
          : "PASSWORDS AREN'T CHECKED IN THIS DEMO"}
      </p>

      <Link
        href="/tickets"
        className="label mt-6 inline-block text-silverfaint hover:text-chalk"
      >
        &larr; BACK TO TICKETS
      </Link>
    </main>
  );
}
