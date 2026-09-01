import Link from "next/link";
import { org } from "@/lib/events";
import { navLinks } from "./Nav";

export default function Footer() {
  return (
    <footer className="border-t border-line pt-14 pb-10">
      <div className="mx-auto w-[92vw] max-w-[1180px]">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-8">
          <div className="font-display chrome text-[clamp(2rem,7vw,4.5rem)] leading-[0.9]">
            WE CAME
            <br />
            TOO PARTY
          </div>
          <div className="label flex flex-wrap gap-6">
            {navLinks.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-silverdim hover:text-chalk"
              >
                {l.label}
              </Link>
            ))}
            <Link href="/login" className="text-silverdim hover:text-chalk">
              SIGN UP / LOGIN
            </Link>
          </div>
        </div>
        <div className="label flex flex-wrap justify-between gap-4 border-t border-line pt-6 text-silverfaint">
          <span>© 2026 WECAMETOOPARTY · NEW YORK CITY</span>
          <span className="flex gap-5">
            <a
              href={org.instagram}
              target="_blank"
              rel="noopener"
              className="hover:text-chalk"
            >
              {org.instagramHandle.toUpperCase()}
            </a>
            <a
              href={org.twitter}
              target="_blank"
              rel="noopener"
              className="hover:text-chalk"
            >
              {org.handle.toUpperCase()}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
