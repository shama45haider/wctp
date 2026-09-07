import Image from "next/image";
import {
  ROLES,
  roster,
  byRole,
  isFilled,
  type Artist,
  type Role,
} from "@/lib/artists";
import { org } from "@/lib/events";
import { asset } from "@/lib/asset";

export const metadata = { title: "Meet The Team — WECAMETOOPARTY" };

const pad = (n: number) => String(n).padStart(2, "0");

const labelOf = (role: Role) => ROLES.find((r) => r.id === role)!.label;

function FilledCard({ a }: { a: Artist }) {
  return (
    <article className="group relative border border-line bg-ink transition-colors hover:border-linehi">
      <div className="relative aspect-[4/5] overflow-hidden">
        {a.imageUrl ? (
          <Image
            src={asset(a.imageUrl)}
            alt={a.name!}
            fill
            sizes="(max-width:640px) 92vw, (max-width:1024px) 45vw, 280px"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="label flex h-full items-center justify-center bg-ink2 text-silverfaint">
            NO PHOTO
          </div>
        )}
        <span className="label absolute top-0 left-0 bg-void/85 px-2 py-1 text-silverfaint">
          {pad(a.slot)}
        </span>
      </div>

      <div className="px-5 pt-4 pb-6">
        <h3 className="font-display text-[1.6rem]">{a.name}</h3>
        <div className="label mt-1 text-bloodhi">{labelOf(a.role)}</div>
        {a.title && (
          <div className="label mt-1 text-silverdim">{a.title.toUpperCase()}</div>
        )}
        {a.bio && (
          <p className="mt-3 text-sm leading-relaxed text-silverdim">{a.bio}</p>
        )}
        {(a.instagram || a.soundcloud) && (
          <div className="label mt-4 flex gap-5 border-t border-line pt-1">
            {a.instagram && (
              <a
                href={a.instagram}
                target="_blank"
                rel="noopener"
                className="inline-block py-3 text-silverfaint transition-colors hover:text-chalk"
              >
                INSTAGRAM
              </a>
            )}
            {a.soundcloud && (
              <a
                href={a.soundcloud}
                target="_blank"
                rel="noopener"
                className="inline-block py-3 text-silverfaint transition-colors hover:text-chalk"
              >
                SOUNDCLOUD
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function EmptySlot({ a }: { a: Artist }) {
  return (
    <article className="relative border border-dashed border-linehi bg-ink/40">
      <div className="hairline-x relative flex aspect-[4/5] items-center justify-center opacity-25" />
      <span className="font-display absolute top-3 left-4 text-[2.5rem] leading-none text-linehi">
        {pad(a.slot)}
      </span>
      <div className="border-t border-dashed border-linehi px-5 pt-4 pb-6">
        <h3 className="font-display text-[1.6rem] text-silverfaint">
          Slot {pad(a.slot)}
        </h3>
        <p className="label mt-2 leading-loose text-silverfaint">
          {labelOf(a.role)} &middot; ANNOUNCING SOON
        </p>
      </div>
    </article>
  );
}

export default function Team() {
  const announced = roster.filter(isFilled).length;

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <div className="flex flex-col items-start gap-3 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div>
          <h1 className="font-display chrome text-[clamp(2.5rem,8vw,5.5rem)] leading-[0.82]">
            Meet The Team
          </h1>
          <p className="mt-4 max-w-[46ch] leading-relaxed text-silverdim">
            The people behind the nights. Want on the roster? Reach us at{" "}
            <a
              href={org.instagram}
              target="_blank"
              rel="noopener"
              className="text-chalk underline decoration-blood underline-offset-4 hover:text-bloodhi"
            >
              {org.instagramHandle}
            </a>{" "}
            or{" "}
            <a
              href={`mailto:${org.email}`}
              className="text-chalk underline decoration-blood underline-offset-4 hover:text-bloodhi"
            >
              {org.email}
            </a>
            .
          </p>
        </div>
        <div className="label text-silverfaint sm:shrink-0">
          {pad(announced)} OF {pad(roster.length)} ANNOUNCED
        </div>
      </div>

      {/* One section per role, in ROLES order. Every section shares the same
          four-column grid so a card is the same width all the way down the
          page; the two-card CEO and DJ sections simply fill two of the four
          columns on a wide screen rather than stretching to a different size. */}
      {ROLES.map((r) => {
        const slots = byRole(r.id);
        return (
          <section key={r.id} id={`${r.id}s`} className="mt-12 scroll-mt-28">
            <div className="mb-6 border-b border-line pb-4">
              <h2 className="font-display text-[clamp(1.9rem,5vw,3rem)]">
                {r.heading}
              </h2>
              <p className="mt-2 max-w-[42ch] text-silverdim">{r.blurb}</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {slots.map((a) =>
                isFilled(a) ? (
                  <FilledCard key={a.slot} a={a} />
                ) : (
                  <EmptySlot key={a.slot} a={a} />
                ),
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
}
