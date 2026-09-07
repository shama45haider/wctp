import type { Metadata } from "next";
import Link from "next/link";
import Flyer from "@/components/Flyer";
import { allEvents, org, monthOf, dayOf } from "@/lib/events";
import { getInstagramPosts } from "@/lib/instagram";

export const metadata: Metadata = {
  title: "Gallery · WECAMETOOPARTY",
  description:
    "Every flyer WECAMETOOPARTY has made, and the feed from @wearethepartynyc.",
};

/**
 * Every flyer this crew has made, one wall, oldest and newest side by side.
 *
 * Reads allEvents directly rather than through useRuntimeEvents: nothing
 * here depends on whether a date has passed - a flyer is still a flyer once
 * the night is over - so this stays a plain server component with no need
 * to ask a browser what day it is. See lib/now.ts for the pages that do.
 */
export default function Gallery() {
  const posts = getInstagramPosts();
  const flyers = allEvents.filter((e) => e.imageId);

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <h1 className="font-display chrome text-[clamp(2.5rem,8vw,5.5rem)] leading-[0.82]">
        Gallery
      </h1>
      <p className="mt-4 max-w-[52ch] leading-relaxed text-silverdim">
        Every flyer we&rsquo;ve put out, and the feed from{" "}
        {org.instagramHandle}. Nothing here gets taken down.
      </p>

      <div className="mt-10 flex items-end justify-between gap-4 border-b border-line pb-4">
        <h2 className="font-display text-[clamp(1.9rem,5vw,3rem)]">
          Flyers
        </h2>
        <span className="label text-silverfaint">
          {String(flyers.length).padStart(2, "0")} SO FAR
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {flyers.map((e) => (
          <Link
            key={e.slug}
            href={`/events/${e.slug}`}
            className="group relative block aspect-[4/5] overflow-hidden border border-line bg-ink transition-colors hover:border-linehi"
          >
            <Flyer
              id={e.imageId!}
              alt={e.title}
              sizes="(max-width:639px) 46vw, (max-width:1023px) 30vw, 220px"
              maxWidth={400}
              className="transition-transform duration-500 group-hover:scale-[1.03]"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-[rgba(5,5,5,0.88)] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="label absolute right-2 bottom-2 left-2 line-clamp-2 text-silver opacity-0 transition-opacity group-hover:opacity-100">
              {e.title} &middot; {dayOf(e.date)} {monthOf(e.date)}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-14 flex items-end justify-between gap-4 border-b border-line pb-4">
        <h2 className="font-display text-[clamp(1.9rem,5vw,3rem)]">
          From Instagram
        </h2>
        {posts.length > 0 && (
          <span className="label text-silverfaint">
            {String(posts.length).padStart(2, "0")} POSTS
          </span>
        )}
      </div>

      {posts.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
          {posts.map((p) => (
            <a
              key={p.id}
              href={p.permalink}
              target="_blank"
              rel="noopener"
              className="group relative aspect-square overflow-hidden bg-void"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumbnailUrl ?? p.mediaUrl}
                alt={p.caption?.slice(0, 120) ?? "Instagram post"}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover grayscale-[0.35] transition-[filter,transform] duration-500 group-hover:scale-[1.03] group-hover:grayscale-0"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-[rgba(5,5,5,0.9)] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              {p.caption && (
                <span className="label absolute right-3 bottom-3 left-3 line-clamp-3 text-silver opacity-0 transition-opacity group-hover:opacity-100">
                  {p.caption}
                </span>
              )}
              {p.mediaType === "VIDEO" && (
                <span className="label absolute top-2 right-2 bg-void/80 px-1.5 py-0.5 text-bloodhi">
                  REEL
                </span>
              )}
            </a>
          ))}
        </div>
      ) : (
        <div className="mt-6 border border-line">
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="hairline-x aspect-square bg-void opacity-30"
              />
            ))}
          </div>
          <div className="label flex flex-wrap items-center justify-between gap-4 border-t border-line p-5 text-silverfaint">
            <span>NEW POSTS DROP HERE</span>
            <a
              href={org.instagram}
              target="_blank"
              rel="noopener"
              className="border border-linehi px-3 py-2 text-silver transition-colors hover:border-bloodhi hover:text-bloodhi"
            >
              FOLLOW {org.instagramHandle.toUpperCase()} &rarr;
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
