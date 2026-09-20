"use client";

import { useRef, useState } from "react";
import { siteImageUrl, uploadSiteImage } from "@/lib/site-content";

/** The small grey caption under the grid. Matches the form it sits in. */
const hint = "mt-2 text-[0.8125rem] leading-relaxed text-silverfaint";

/** How many pictures one date may carry. The database agrees - see 0018. */
export const MAX_PHOTOS = 5;

/**
 * Up to five pictures, the first of which is the flyer.
 *
 * Uploads go straight into the bucket on pick rather than waiting for the form
 * to be submitted: an upload is slow enough that batching it behind Save would
 * mean a long dead press with nothing moving, and a picture that lands in the
 * bucket without ever being referenced costs nothing.
 */
export default function EventPhotoPicker({
  paths,
  onChange,
  disabled,
}: {
  paths: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const room = MAX_PHOTOS - paths.length;

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);

    // Sliced rather than refused: picking eight when there is room for two
    // should take the first two, not throw the whole selection away.
    const chosen = Array.from(files).slice(0, Math.max(room, 0));
    setBusy(chosen.length);

    const added: string[] = [];
    for (const file of chosen) {
      const out = await uploadSiteImage(file, "events");
      if (out.path) added.push(out.path);
      else if (out.error) setError(out.error);
    }

    setBusy(0);
    if (added.length) onChange([...paths, ...added].slice(0, MAX_PHOTOS));
    if (inputRef.current) inputRef.current.value = "";
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= paths.length) return;
    const next = [...paths];
    const [held] = next.splice(from, 1);
    next.splice(to, 0, held);
    onChange(next);
  };

  // The row stays in the bucket. Un-listing it here is what takes it off the
  // site, and keeping the file means a mis-tap is not a lost photo.
  const drop = (i: number) => onChange(paths.filter((_, n) => n !== i));

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {paths.map((path, i) => (
          <div
            key={path}
            className="group relative aspect-square overflow-hidden border border-line bg-ink2"
          >
            {/* A path that will not resolve - no client, a bucket that has
                moved - draws the empty hatch rather than src="", which some
                browsers treat as a request for the page itself. */}
            {siteImageUrl(path) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={siteImageUrl(path) as string}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="hairline-x h-full w-full" />
            )}
            {i === 0 && (
              <span className="label absolute top-1 left-1 bg-void/85 px-1.5 py-0.5 text-chalk">
                FLYER
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-void/85 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                disabled={i === 0 || disabled}
                aria-label="Move earlier"
                className="px-2 py-1 text-silverdim hover:text-chalk disabled:opacity-25"
              >
                &larr;
              </button>
              <button
                type="button"
                onClick={() => drop(i)}
                disabled={disabled}
                aria-label="Remove"
                className="px-2 py-1 text-silverdim hover:text-bloodhi"
              >
                &times;
              </button>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                disabled={i === paths.length - 1 || disabled}
                aria-label="Move later"
                className="px-2 py-1 text-silverdim hover:text-chalk disabled:opacity-25"
              >
                &rarr;
              </button>
            </div>
          </div>
        ))}

        {Array.from({ length: busy }).map((_, i) => (
          <div
            key={`up-${i}`}
            className="label flex aspect-square animate-pulse items-center justify-center border border-dashed border-line text-silverfaint"
          >
            …
          </div>
        ))}

        {room > 0 && busy === 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="label flex aspect-square flex-col items-center justify-center gap-1 border border-dashed border-line text-silverfaint transition-colors hover:border-linehi hover:bg-ink2 hover:text-chalk disabled:opacity-40"
          >
            <span className="text-[1.25rem] leading-none">+</span>
            ADD
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void pick(e.target.files)}
        className="hidden"
      />

      <p className={hint}>
        {paths.length === 0
          ? `Up to ${MAX_PHOTOS}. The first one is the flyer.`
          : `${paths.length} of ${MAX_PHOTOS}. Arrows reorder, the first is the flyer.`}
      </p>

      {error && (
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-bloodhi" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
