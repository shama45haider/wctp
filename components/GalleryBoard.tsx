"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Flyer from "./Flyer";
import { allEvents, org, monthOf, dayOf } from "@/lib/events";
import type { IgPost } from "@/lib/instagram";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  useGallery,
  uploadSiteImage,
  addGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  MAX_IMAGE_BYTES,
  type GalleryItem,
} from "@/lib/site-content";
import { btn, btnGo, field } from "@/lib/ui";
import { Editable } from "./Editable";

/**
 * The gallery, in three walls: the photos an admin puts up, every flyer this
 * crew has made, and the feed from Instagram.
 *
 * A client component now because of the first wall. The flyers and the feed
 * have not changed - they are still a build-time list and a build-time file -
 * but the photos come out of gallery_items in the browser, and the owner
 * wanted to add and edit them from the page itself rather than from a
 * dashboard nobody opens. Everything admin-only hangs off `ready && isAdmin`,
 * so a guest's markup is exactly what it always was and nobody sees an Edit
 * button flash past while the session is still being read.
 *
 * The first paint has no photos in it and no admin controls, because
 * useGallery starts empty and isAdmin is false until the session resolves -
 * which is what the static export shipped, so hydration has nothing to
 * disagree with. Everything here appears after that first paint or not at all.
 *
 * `posts` comes in as a prop for the same reason it does on the home page:
 * getInstagramPosts reads data/instagram.json with node:fs, which cannot run
 * in a browser, so app/gallery/page.tsx stays a server component and hands the
 * finished list down.
 */

const MAX_MB = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));

/** One file on its way up, and how far it got. */
type Upload = {
  name: string;
  /** Object URL for the thumbnail, revoked when the queue is cleared. */
  url: string;
  state: "waiting" | "going" | "done" | "failed";
  error?: string;
};

function PhotoTile({
  item,
  canEdit,
  onEdit,
}: {
  item: GalleryItem;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <figure className="group relative border border-line bg-ink transition-colors hover:border-linehi">
      <div className="relative aspect-[4/5] overflow-hidden">
        {/* A public bucket URL, which next/image cannot help with even before
            the static export rules it out. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt={item.caption ?? `A night with ${org.instagramHandle}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-[rgba(5,5,5,0.88)] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        {item.caption && (
          <figcaption className="label absolute right-2 bottom-2 left-2 line-clamp-2 text-silver opacity-0 transition-opacity group-hover:opacity-100">
            {item.caption}
          </figcaption>
        )}
        {/* Only an admin is ever handed an unpublished row, and the badge is
            the only way to find one again once it is off the public page. */}
        {canEdit && !item.published && (
          <span className="label absolute top-2 left-2 bg-void/85 px-1.5 py-0.5 text-bloodhi">
            HIDDEN
          </span>
        )}
      </div>
      {canEdit && (
        // Always on screen rather than revealed on hover: a phone has no
        // hover, and this is the page the owner edits from.
        <button
          type="button"
          onClick={onEdit}
          className="label flex min-h-11 w-full items-center justify-center border-t border-line text-silverdim transition-colors hover:text-chalk"
        >
          EDIT
        </button>
      )}
    </figure>
  );
}

function PhotoEditor({
  item,
  onClose,
  reload,
}: {
  item: GalleryItem;
  onClose: () => void;
  reload: () => void;
}) {
  const [caption, setCaption] = useState(item.caption ?? "");
  const [sort, setSort] = useState(String(item.sort));
  const [published, setPublished] = useState(item.published);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const save = async () => {
    const order = Number(sort);
    if (!Number.isFinite(order)) {
      return setError("Order has to be a number.");
    }

    setBusy(true);
    setError(null);
    const out = await updateGalleryItem(item.id, {
      caption,
      sort: Math.trunc(order),
      published,
    });
    if (!alive.current) return;
    setBusy(false);
    if (!out.ok) return setError(out.error ?? "Nothing was saved.");
    reload();
    onClose();
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const out = await deleteGalleryItem(item.id, item.imagePath);
    if (!alive.current) return;
    setBusy(false);
    if (!out.ok) return setError(out.error ?? "Nothing was removed.");
    reload();
    onClose();
  };

  return (
    <div className="col-span-full border border-linehi bg-ink2 p-4 sm:p-5">
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden border border-line bg-void sm:w-[180px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={item.caption ?? "The photo being edited"}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={`cap-${item.id}`} className="label text-silverfaint">
              CAPTION
            </label>
            <input
              id={`cap-${item.id}`}
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={busy}
              placeholder="Optional"
              className={`${field} w-full`}
            />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex flex-1 flex-col gap-2">
              <label
                htmlFor={`sort-${item.id}`}
                className="label text-silverfaint"
              >
                ORDER - LOWER SHOWS FIRST
              </label>
              <input
                id={`sort-${item.id}`}
                type="number"
                inputMode="numeric"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                disabled={busy}
                className={`${field} w-full [color-scheme:dark]`}
              />
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <span className="label text-silverfaint">ON THE PAGE</span>
              <button
                type="button"
                onClick={() => setPublished((p) => !p)}
                disabled={busy}
                aria-pressed={published}
                className={`${field} flex w-full items-center justify-between disabled:opacity-50 ${
                  published ? "text-chalk" : "text-bloodhi"
                }`}
              >
                <span className="label">{published ? "SHOWING" : "HIDDEN"}</span>
                <span className="label text-silverfaint">TAP TO SWAP</span>
              </button>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="label border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button onClick={save} disabled={busy} className={`${btnGo} sm:flex-1`}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={onClose}
              disabled={busy}
              className={`${btn} sm:flex-1`}
            >
              Cancel
            </button>
          </div>

          {/* Two taps, because the file goes with the row and there is no
              putting either back. */}
          <button
            type="button"
            onClick={() => (confirming ? void remove() : setConfirming(true))}
            disabled={busy}
            className="label min-h-11 self-start text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-bloodhi hover:decoration-bloodhi disabled:opacity-50"
          >
            {confirming ? "TAP AGAIN TO REMOVE IT FOR GOOD" : "REMOVE THIS PHOTO"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GalleryBoard({ posts }: { posts: IgPost[] }) {
  const { ready, isAdmin } = useSupabaseAuth();
  const { items, error, reload } = useGallery();

  const [editing, setEditing] = useState<string | null>(null);
  const [queue, setQueue] = useState<Upload[] | null>(null);
  const [busy, setBusy] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The bytes behind an object URL are held by the document until the URL is
  // revoked, and a batch of photos off a phone is tens of megabytes of them.
  const urls = useRef<string[]>([]);
  const forget = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
  };
  useEffect(() => () => forget(), []);

  const canEdit = ready && isAdmin;
  const flyers = allEvents.filter((e) => e.imageId);

  // The policy behind gallery_items already hides an unpublished row from a
  // guest, but what is drawn should not depend on a rule in another system
  // being right. An admin is the only session that sees one, badged.
  const shown = canEdit ? items : items.filter((i) => i.published);
  const showPhotos = shown.length > 0 || canEdit;

  const upload = async (files: File[]) => {
    forget();
    const started: Upload[] = files.map((f) => {
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      return { name: f.name, url, state: "waiting" };
    });
    setQueue(started);
    setBusy(true);

    const mark = (i: number, patch: Partial<Upload>) =>
      setQueue((q) => q && q.map((u, j) => (j === i ? { ...u, ...patch } : u)));

    // One at a time on purpose: this runs off a phone as often as a laptop,
    // and eight photos racing each other up one uplink finish no sooner and
    // fail together.
    for (let i = 0; i < files.length; i++) {
      if (alive.current) mark(i, { state: "going" });

      const up = await uploadSiteImage(files[i], "gallery");
      let failure = up.error;
      if (!failure && up.path) {
        const added = await addGalleryItem(up.path);
        if (!added.ok) failure = added.error ?? "The photo was not saved.";
      }
      if (!alive.current) continue;
      mark(i, failure ? { state: "failed", error: failure } : { state: "done" });
    }

    if (!alive.current) return;
    setBusy(false);
    reload();
  };

  const done = queue?.filter((u) => u.state === "done" || u.state === "failed").length ?? 0;

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <h1 className="font-display chrome text-[clamp(2.5rem,8vw,5.5rem)] leading-[0.82]">
        <Editable k="gallery.heading">Gallery</Editable>
      </h1>
      <p className="mt-4 max-w-[52ch] leading-relaxed text-silverdim">
        <Editable k="gallery.intro">
          {`Every flyer we’ve put out, and the feed from ${org.instagramHandle}. Nothing here gets taken down.`}
        </Editable>
      </p>

      {showPhotos && (
        <>
          <div className="mt-10 flex items-end justify-between gap-4 border-b border-line pb-4">
            <h2 className="font-display text-[clamp(1.9rem,5vw,3rem)]">
              <Editable k="gallery.photos.title">Photos</Editable>
            </h2>
            {shown.length > 0 && (
              <span className="label text-silverfaint">
                {String(shown.length).padStart(2, "0")}{" "}
                <Editable k="gallery.photos.countLabel">SHOTS</Editable>
              </span>
            )}
          </div>

          {canEdit && (
            <div className="mt-6 border border-dashed border-linehi p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="label text-bloodhi">ADMIN</span>
                  <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-silverdim">
                    These go straight onto the page. Pick as many as you like at
                    once - up to {MAX_MB} MB each - then use Edit on any of them
                    to caption it, reorder it or take it down.
                  </p>
                </div>
                {/* A label wrapping the input rather than a button that clicks
                    it, so the picker opens with no script on the path and the
                    input keeps its place in the tab order. */}
                <label
                  className={`${btnGo} shrink-0 ${busy ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  {busy
                    ? `Uploading ${done + 1} of ${queue?.length ?? 0}…`
                    : "Add photos"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={busy}
                    className="sr-only"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      // Cleared so picking the same file twice fires again.
                      e.target.value = "";
                      if (picked.length > 0) void upload(picked);
                    }}
                  />
                </label>
              </div>

              {queue && queue.length > 0 && (
                <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
                  {queue.map((u, i) => (
                    <li key={`${u.name}-${i}`} className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u.url}
                        alt=""
                        className="h-11 w-11 shrink-0 border border-line object-cover"
                      />
                      <span className="label min-w-0 flex-1 truncate text-silverdim">
                        {u.name}
                      </span>
                      <span
                        className={`label shrink-0 ${
                          u.state === "failed" ? "text-bloodhi" : "text-silverfaint"
                        }`}
                      >
                        {u.state === "waiting" && "WAITING"}
                        {u.state === "going" && "UPLOADING…"}
                        {u.state === "done" && "UP"}
                        {u.state === "failed" && "FAILED"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Verbatim, because the useful ones name the migration that has
                  not been run yet rather than anything the owner did wrong. */}
              {queue?.some((u) => u.error) && (
                <div role="alert" className="mt-4 flex flex-col gap-2">
                  {queue
                    .filter((u) => u.error)
                    .map((u, i) => (
                      <p
                        key={`${u.name}-err-${i}`}
                        className="label border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
                      >
                        {u.name}: {u.error}
                      </p>
                    ))}
                </div>
              )}

              {queue && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    forget();
                    setQueue(null);
                  }}
                  className="label mt-4 min-h-11 text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk"
                >
                  CLEAR THIS LIST
                </button>
              )}

              {error && (
                <p
                  role="alert"
                  className="label mt-4 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi"
                >
                  {error}
                </p>
              )}
            </div>
          )}

          {shown.length > 0 ? (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {shown.map((item) =>
                canEdit && editing === item.id ? (
                  <PhotoEditor
                    key={item.id}
                    item={item}
                    onClose={() => setEditing(null)}
                    reload={reload}
                  />
                ) : (
                  <PhotoTile
                    key={item.id}
                    item={item}
                    canEdit={canEdit}
                    onEdit={() => setEditing(item.id)}
                  />
                ),
              )}
            </div>
          ) : (
            <div className="mt-6 border border-dashed border-linehi p-10 text-center">
              <p className="font-display text-2xl">
                <Editable k="gallery.photos.emptyTitle">No photos up yet</Editable>
              </p>
              <p className="mt-2 text-sm text-silverdim">
                <Editable k="gallery.photos.emptyBlurb">
                  Add the first ones and they appear here for everybody.
                </Editable>
              </p>
            </div>
          )}
        </>
      )}

      <div
        className={`${showPhotos ? "mt-14" : "mt-10"} flex items-end justify-between gap-4 border-b border-line pb-4`}
      >
        <h2 className="font-display text-[clamp(1.9rem,5vw,3rem)]">
          <Editable k="gallery.flyers.title">Flyers</Editable>
        </h2>
        <span className="label text-silverfaint">
          {String(flyers.length).padStart(2, "0")}{" "}
          <Editable k="gallery.flyers.countLabel">SO FAR</Editable>
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
          <Editable k="gallery.instagram.title">From Instagram</Editable>
        </h2>
        {posts.length > 0 && (
          <span className="label text-silverfaint">
            {String(posts.length).padStart(2, "0")}{" "}
            <Editable k="gallery.instagram.countLabel">POSTS</Editable>
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
            <span>
              <Editable k="gallery.instagram.empty">NEW POSTS DROP HERE</Editable>
            </span>
            <a
              href={org.instagram}
              target="_blank"
              rel="noopener"
              className="flex min-h-11 items-center border border-linehi px-3 text-silver transition-colors hover:border-bloodhi hover:text-bloodhi"
            >
              FOLLOW {org.instagramHandle.toUpperCase()} &rarr;
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
