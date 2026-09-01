"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/demo-account";

/**
 * Age check. This deliberately never accepts a document file — the "scan" is a
 * simulation, so nobody can hand a real government ID to a static site. A live
 * build should hand this step to a KYC provider (Stripe Identity, Persona,
 * Veriff) and keep the document off our own infrastructure entirely.
 */

type Stage = "dob" | "scanning" | "done";

const MIN_AGE = 18;

const field =
  "border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none";

function ageFrom(dob: string) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export default function Verify() {
  const router = useRouter();
  const { ready, user, cart, markVerified } = useAccount();

  const [stage, setStage] = useState<Stage>("dob");
  const [dob, setDob] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (stage !== "scanning") return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          window.clearInterval(id);
          const age = ageFrom(dob);
          if (age !== null) markVerified(new Date(dob).getFullYear());
          setStage("done");
          return 100;
        }
        return p + 5;
      });
    }, 60);
    return () => window.clearInterval(id);
  }, [stage, dob, markVerified]);

  if (ready && !user) {
    return (
      <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(2.5rem,7vw,5rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,6vw,3rem)]">
          Sign in first
        </h1>
        <p className="mt-3 text-silverdim">
          You need an account before we can run the ID check.
        </p>
        <Link
          href="/login"
          className="font-display mt-6 inline-block border border-[rgba(200,16,46,0.5)] px-6 py-3 tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const age = ageFrom(dob);
    if (age === null) return setError("Enter a valid date.");
    if (age < MIN_AGE) return setError(`You must be ${MIN_AGE} or over.`);
    if (age > 120) return setError("Enter a valid date.");
    setError(null);
    setProgress(0);
    setStage("scanning");
  };

  return (
    <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,7vw,5rem)]">
      <div className="label mb-5 flex gap-2 text-silverfaint">
        {["DETAILS", "ID CHECK", "CLEARED"].map((s, i) => {
          const active =
            (stage === "dob" && i === 1) ||
            (stage === "scanning" && i === 1) ||
            (stage === "done" && i === 2);
          const passed = i === 0 || (stage === "done" && i < 2);
          return (
            <span
              key={s}
              className={`flex-1 border-t-2 pt-2 ${
                active
                  ? "border-blood text-bloodhi"
                  : passed
                    ? "border-linehi text-silverdim"
                    : "border-line"
              }`}
            >
              {s}
            </span>
          );
        })}
      </div>

      {stage === "dob" && (
        <>
          <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
            Age check
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            Our nights are {MIN_AGE}+. Confirm your date of birth and we&rsquo;ll
            run a quick ID check. You only do this once.
          </p>

          <form className="mt-7" onSubmit={start}>
            <div className="mb-2 flex flex-col gap-2">
              <label htmlFor="dob" className="label text-silverfaint">
                DATE OF BIRTH
              </label>
              <input
                id="dob"
                type="date"
                required
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className={`${field} [color-scheme:dark]`}
              />
            </div>
            {error && (
              <p className="label mt-3 text-bloodhi" role="alert">
                {error.toUpperCase()}
              </p>
            )}
            <button
              type="submit"
              className="font-display mt-6 w-full border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi"
            >
              Continue
            </button>
          </form>

          <p className="label mt-5 leading-loose text-silverfaint">
            WE KEEP YOUR BIRTH YEAR ONLY. NO DOCUMENT IS UPLOADED OR STORED.
          </p>
        </>
      )}

      {stage === "scanning" && (
        <>
          <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
            Checking ID
          </h1>
          <div className="mt-8 border border-line bg-ink p-6">
            <div className="hairline-x mb-5 flex aspect-[8/5] items-center justify-center opacity-40" />
            <div className="h-1 w-full bg-line">
              <div
                className="h-full bg-blood transition-[width] duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="label mt-3 flex justify-between text-silverfaint">
              <span>READING DOCUMENT</span>
              <span>{progress}%</span>
            </p>
          </div>
        </>
      )}

      {stage === "done" && (
        <>
          <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
            You&rsquo;re cleared
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            {user?.name}, you&rsquo;re verified for {MIN_AGE}+ nights. RSVP to
            anything on the calendar.
          </p>
          <div className="label mt-6 flex items-center justify-between border border-line px-3 py-3">
            <span className="text-silverfaint">ID STATUS</span>
            <span className="text-bloodhi">VERIFIED</span>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {/* Straight back to the order they were held out of, if there is one. */}
            <button
              onClick={() => router.push(cart ? "/checkout" : "/tickets")}
              className="font-display border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
            >
              {cart ? "Back to checkout" : "Browse tickets"}
            </button>
            <Link
              href="/account"
              className="font-display border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 text-center tracking-[0.12em] text-chalk uppercase hover:border-silverdim"
            >
              My account
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
