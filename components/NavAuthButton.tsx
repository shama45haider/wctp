"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSupabaseAuth } from "@/lib/supabase-auth";

/**
 * The account menu - everything to do with whoever is signed in, in one place.
 *
 * Profile things used to be scattered: MY TICKETS sat in the main nav next to
 * HOME and TICKETS while pointing at the same page this button did, the ID
 * check was only reachable from inside that page, and the way into the
 * dashboard was a link at the bottom of the sign-in screen. Three different
 * routes to the same account, none of them obviously the account. This is now
 * the one door, and the nav row beside it is only the pages anyone can look at
 * without signing in.
 *
 * Split out of Nav because Nav is a server component and cannot know whether
 * anyone is signed in. The signed-out label is also the first client render,
 * matching what the static export ships, so hydration has nothing to disagree
 * about - the label only changes once the session is actually known.
 */

const TRIGGER =
  "font-display flex min-h-11 items-center gap-2 border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-[1.15rem] text-base tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim hover:shadow-[0_8px_30px_-12px_rgba(180,195,215,0.35)]";

const ITEM =
  "label flex min-h-11 items-center justify-between gap-4 border-b border-line px-4 text-silverdim transition-colors last:border-b-0 hover:bg-ink2 hover:text-chalk";

export default function NavAuthButton() {
  const { ready, user, isAdmin, signOut } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const signedIn = ready && Boolean(user);

  // Following a link inside the menu does not unmount this component - the nav
  // is in the layout - so without this the panel would still be hanging open
  // over whatever page it just went to.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to open when there is no session: the only thing behind this would
  // be a single "sign in" item, and a menu holding one link is a worse button
  // than the link itself.
  if (!signedIn) {
    return (
      <Link href="/login" className={TRIGGER}>
        Sign in
      </Link>
    );
  }

  const label = user?.email?.split("@")[0] ?? "Account";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={TRIGGER}
      >
        <span className="max-w-[9ch] truncate">{label}</span>
        <span aria-hidden className="text-silverdim">
          {open ? "⌃" : "⌄"}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          // Right-aligned so it opens inward from the corner rather than off
          // the edge of a phone.
          className="absolute right-0 z-50 mt-2 w-[min(17rem,80vw)] border border-linehi bg-void shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="label text-silverfaint">SIGNED IN AS</p>
            <p className="mt-1 truncate text-[0.9375rem] text-chalk">
              {user?.email}
            </p>
          </div>

          <Link href="/profile" role="menuitem" className={ITEM}>
            Your profile
          </Link>

          <Link href="/account" role="menuitem" className={ITEM}>
            Your tickets
          </Link>

          <Link href="/verify" role="menuitem" className={ITEM}>
            ID check
          </Link>

          {isAdmin && (
            <Link href="/admin" role="menuitem" className={ITEM}>
              Admin dashboard
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className={`${ITEM} w-full text-left`}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
