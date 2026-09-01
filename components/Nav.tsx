import Link from "next/link";

export const navLinks = [
  { href: "/", label: "HOME" },
  { href: "/#events", label: "TICKETS" },
  { href: "/artists", label: "ARTISTS" },
  { href: "/partners", label: "PARTNERS" },
];

export default function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-void/80 backdrop-blur-xl">
      <div className="mx-auto flex w-[92vw] max-w-[1180px] items-center justify-between gap-8 py-4">
        <Link
          href="/"
          className="font-display -my-2 py-2 text-[1.0625rem] tracking-[0.14em]"
        >
          WCTP
        </Link>
        <div className="label hidden gap-7 md:flex">
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
        <Link
          href="/login"
          className="font-display flex min-h-11 items-center border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-[1.15rem] text-base tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim hover:shadow-[0_8px_30px_-12px_rgba(180,195,215,0.35)]"
        >
          Sign up / Login
        </Link>
      </div>

      {/* second row on small screens, where the inline links don't fit */}
      <div className="label flex gap-6 border-t border-line md:hidden">
        <div className="mx-auto flex w-[92vw] max-w-[1180px] gap-6">
          {navLinks.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="py-3.5 text-silverdim transition-colors hover:text-chalk"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
