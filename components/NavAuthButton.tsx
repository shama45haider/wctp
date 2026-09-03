"use client";

import Link from "next/link";
import { useSupabaseAuth } from "@/lib/supabase-auth";

/**
 * The nav's account button.
 *
 * Split out of Nav, which is a server component and so cannot know whether
 * anyone is signed in. Before this the bar offered "Sign up / Login" to people
 * who were already signed in, which reads as having been quietly logged out.
 *
 * The signed-out label is also the first render on the client, matching what
 * the export shipped, so hydration has nothing to disagree about - the label
 * only changes once the session is actually known.
 */

const STYLE =
  "font-display flex min-h-11 items-center border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-[1.15rem] text-base tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim hover:shadow-[0_8px_30px_-12px_rgba(180,195,215,0.35)]";

export default function NavAuthButton() {
  const { ready, user } = useSupabaseAuth();
  const signedIn = ready && Boolean(user);

  return (
    <Link href={signedIn ? "/account" : "/login"} className={STYLE}>
      {signedIn ? "Account" : "Sign up / Login"}
    </Link>
  );
}
