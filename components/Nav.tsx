import Link from "next/link";
import NavAuthButton from "./NavAuthButton";

export const navLinks = [
  { href: "/", label: "HOME" },
  { href: "/tickets", label: "TICKETS" },
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

      {/* Second row below lg, where five inline links stop fitting beside the
          button. It scrolls sideways rather than wrapping, so the bar keeps a
          single predictable height at every width. */}
      <div className="relative border-t border-line lg:hidden">
        {/* Fades the last link out at the right edge so a cut-off word reads as
            "there is more this way" rather than as broken text. */}
        <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-void to-transparent" />
        <div className="mx-auto w-[92vw] max-w-[1180px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="label flex w-max gap-6">
            {navLinks.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="py-3.5 whitespace-nowrap text-silverdim transition-colors hover:text-chalk"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
