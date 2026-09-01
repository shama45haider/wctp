import Image from "next/image";
import { artists, isFilled, type Artist } from "@/lib/artists";
import { org } from "@/lib/events";
import { asset } from "@/lib/asset";

export const metadata = { title: "Meet Our Artists — WECAMETOOPARTY" };

const pad = (n: number) => String(n).padStart(2, "0");

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
        <h2 className="font-display text-[1.6rem]">{a.name}</h2>
        {a.role && (
          <div className="label mt-1 text-bloodhi">{a.role.toUpperCase()}</div>
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

function EmptySlot({ slot }: { slot: number }) {
  return (
    <article className="relative border border-dashed border-linehi bg-ink/40">
      <div className="hairline-x relative flex aspect-[4/5] items-center justify-center opacity-25" />
      <span className="font-display absolute top-3 left-4 text-[2.5rem] leading-none text-linehi">
        {pad(slot)}
      </span>
      <div className="border-t border-dashed border-linehi px-5 pt-4 pb-6">
        <h2 className="font-display text-[1.6rem] text-silverfaint">
          Slot {pad(slot)}
        </h2>
        <p className="label mt-2 leading-loose text-silverfaint">
          ANNOUNCING SOON
        </p>
      </div>
    </article>
  );
}

export default function Artists() {
  const open = artists.filter((a) => !isFilled(a)).length;

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <div className="flex flex-col items-start gap-3 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div>
          <h1 className="font-display chrome text-[clamp(2.5rem,8vw,5.5rem)] leading-[0.82]">
            Meet Our Artists
          </h1>
          <p className="mt-4 max-w-[46ch] leading-relaxed text-silverdim">
            The people behind the decks. Want on the roster? Reach us at{" "}
            <a
              href={org.instagram}
              target="_blank"
              rel="noopener"
              className="text-chalk underline decoration-blood underline-offset-4 hover:text-bloodhi"
            >
              {org.instagramHandle}
            </a>
            .
          </p>
        </div>
        <div className="label text-silverfaint sm:shrink-0">
          {artists.length} SLOTS
          {open > 0 && ` / ${open} OPEN`}
        </div>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {artists.map((a) =>
          isFilled(a) ? (
            <FilledCard key={a.slot} a={a} />
          ) : (
            <EmptySlot key={a.slot} slot={a.slot} />
          ),
        )}
      </div>
    </main>
  );
}
