"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navLinks } from "./Nav";

/**
 * The phone's bottom tab bar - the same five pages as the desktop nav, below
 * lg only. Replaces the sideways-scrolling link row the header used to carry
 * on a phone, so the header is just the logo and the account button.
 *
 * Slides away while a text field has focus: on a phone that means the
 * keyboard is up, and a bar pinned above it just eats the little room left.
 */

const ICONS: Record<string, React.ReactNode> = {
  "/": <path d="M3.5 10.5 12 3.5l8.5 7V20.5h-5.5v-6h-6v6H3.5z" />,
  "/tickets": (
    <>
      <path d="M3.5 7.5a2 2 0 0 0 2-2h13a2 2 0 0 0 2 2v2.75a1.75 1.75 0 0 0 0 3.5v2.75a2 2 0 0 0-2 2h-13a2 2 0 0 0-2-2v-2.75a1.75 1.75 0 0 0 0-3.5z" />
      <path d="M14.5 6v2M14.5 11v2M14.5 16v2" />
    </>
  ),
  "/team": (
    <>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9.5" r="2.5" />
      <path d="M16.25 14.1a4.75 4.75 0 0 1 5.25 4.9" />
    </>
  ),
  "/gallery": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m3.5 17 5-4.5 4 3.5 3-2.5 5 4" />
    </>
  ),
  "/donate": (
    <path d="M12 19.5s-7.25-4.4-8.75-8.9A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.75 3.6C19.25 15.1 12 19.5 12 19.5z" />
  ),
};

const NOT_TYPING = new Set(["checkbox", "radio", "range", "button", "submit", "reset", "file", "color", "image"]);

function isTextField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NOT_TYPING.has(target.type);
  return target instanceof HTMLTextAreaElement || target.isContentEditable;
}

export default function TabBar() {
  const pathname = usePathname() ?? "/";
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      if (isTextField(e.target)) setTyping(true);
    };
    const onOut = (e: FocusEvent) => {
      if (isTextField(e.target)) setTyping(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  // The live draw is a screen to watch, not browse from.
  if (path.startsWith("/raffle/live")) return null;
  const isActive = (href: string) =>
    href === "/"
      ? path === "/"
      : path === href || path.startsWith(`${href}/`) || (href === "/tickets" && path.startsWith("/events"));

  return (
    <nav
      aria-label="Primary"
      className={`tabbar fixed inset-x-0 bottom-0 z-50 border-t border-line bg-void/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md transition-transform duration-200 lg:hidden ${
        typing ? "translate-y-full" : ""
      }`}
    >
      <ul className="mx-auto grid max-w-[560px] grid-cols-5">
        {navLinks.map((l) => {
          const active = isActive(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-[3.75rem] flex-col items-center justify-center gap-1 transition-colors ${
                  active ? "text-chalk" : "text-silverfaint"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0 h-0.5 w-7 bg-bloodhi transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
                />
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-[1.375rem] w-[1.375rem]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 1.9 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICONS[l.href]}
                </svg>
                <span className="font-mono text-[0.625rem] tracking-[0.08em]">{l.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
