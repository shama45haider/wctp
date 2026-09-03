import type { Metadata } from "next";
import Link from "next/link";
import { org } from "@/lib/events";

export const metadata: Metadata = {
  title: "Accounts",
  description: "Accounts are coming soon.",
  robots: { index: false },
};

/**
 * Placeholder standing in for the account system.
 *
 * The sign-in flow underneath this route still exists in git history and works
 * against localStorage, but it authenticates nobody - there is no server behind
 * this site yet. Rather than hand real visitors a login box that pretends to
 * hold an account, the route says so plainly and points at the feed, which is
 * where anything actually gets announced.
 *
 * Restore the real page when auth has a backend to talk to.
 */
export default function Login() {
  return (
    <main className="mx-auto flex w-[92vw] max-w-[520px] flex-col items-center py-[clamp(3rem,10vw,6rem)] text-center">
      <span className="label border border-line px-3 py-2 text-silverfaint">
        COMING SOON
      </span>

      <h1 className="font-display chrome mt-7 text-[clamp(2.5rem,9vw,4rem)] leading-[0.85]">
        Accounts
      </h1>

      <p className="mt-4 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
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
