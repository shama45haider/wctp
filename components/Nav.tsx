import Link from "next/link";

const links = [
  { href: "/#events", label: "EVENTS" },
  { href: "/#dispatches", label: "DISPATCHES" },
  { href: "/#archive", label: "ARCHIVE" },
];

export default function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-void/80 backdrop-blur-xl">
      <div className="mx-auto flex w-[92vw] max-w-[1180px] items-center justify-between gap-8 py-4">
        <Link
          href="/"
          className="font-display text-[1.0625rem] tracking-[0.14em]"
        >
          WCTP
        </Link>
        <div className="label hidden gap-7 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-silverdim transition-colors hover:text-chalk"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <Link
          href="/#events"
          className="font-display border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] px-[1.15rem] py-[0.6rem] text-base tracking-[0.12em] text-chalk uppercase transition-all hover:border-silverdim hover:shadow-[0_8px_30px_-12px_rgba(180,195,215,0.35)]"
        >
          RSVP
        </Link>
      </div>
    </nav>
  );
}
