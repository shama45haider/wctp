import Link from "next/link";
import { org } from "@/lib/events";
import { Editable } from "./Editable";
import Logo from "./Logo";
import { navLinks } from "./Nav";

export default function Footer() {
  return (
    <footer className="border-t border-line pt-14 pb-10">
      <div className="mx-auto w-[92vw] max-w-[1180px]">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-6">
          <Logo finish="grunge" className="h-auto w-[clamp(6.5rem,20vw,8.5rem)] -rotate-3" />
          <div className="label -my-3.5 flex flex-wrap gap-x-6">
            {navLinks.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="py-3.5 text-silverdim hover:text-chalk"
              >
                {l.label}
              </Link>
            ))}
            <Link href="/login" className="py-3.5 text-silverdim hover:text-chalk">
              SIGN UP / LOGIN
            </Link>
          </div>
        </div>
        <div className="label flex flex-wrap justify-between gap-4 border-t border-line pt-6 text-silverfaint">
          <span>
            <Editable k="footer.copyright">© 2026 WECAMETOOPARTY · NEW YORK CITY</Editable>
          </span>
          {/* Wraps rather than holding one line: the handle and the address
              together run wider than a 375px phone, and unwrapped they pushed
              the whole document three pixels sideways - every page on the site
              could be dragged horizontally because of this one row. */}
          <span className="-my-3 flex flex-wrap gap-x-5">
            <a
              href={org.instagram}
              target="_blank"
              rel="noopener"
              className="py-3 hover:text-chalk"
            >
              {org.instagramHandle.toUpperCase()}
            </a>
            {/* The one address for anything that matters - the location drop,
                an age check, a lost ticket - so it sits where every page ends. */}
            <a href={`mailto:${org.email}`} className="py-3 break-all hover:text-chalk">
              {org.email.toUpperCase()}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
