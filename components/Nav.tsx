import Link from "next/link";
import NavAuthButton from "./NavAuthButton";

export const navLinks = [
  { href: "/", label: "HOME" },
  { href: "/tickets", label: "TICKETS" },
  { href: "/team", label: "TEAM" },
  { href: "/gallery", label: "GALLERY" },
  { href: "/donate", label: "STORE" },
  { href: "/help", label: "HELP" },
];

/**
 * Below lg the page links live in the bottom TabBar, so the header is only the
 * logo and the account button - one short row, like an app's title bar. The
 * top padding clears a phone's status bar when installed to the home screen.
 * A lighter blur on phones: it is recomputed on every scroll frame.
 */
export default function Nav() {
  return (
    <nav
      aria-label="Site"
      className="sticky top-0 z-50 border-b border-line bg-void/90 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:bg-void/80 lg:backdrop-blur-xl"
    >
      <div className="mx-auto flex w-[92vw] max-w-[1180px] items-center justify-between gap-8 py-2.5 lg:py-4">
        <Link
          href="/"
          className="font-display -my-3 flex min-h-11 items-center text-[1.0625rem] tracking-[0.14em]"
        >
          WCTP
        </Link>
        <div className="label hidden gap-7 lg:flex">
          {navLinks.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="-my-3 py-3 text-silverdim transition-colors hover:text-chalk"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <NavAuthButton />
      </div>
    </nav>
  );
}
