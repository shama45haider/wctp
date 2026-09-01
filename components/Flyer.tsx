const WIDTHS = [256, 400, 640, 900, 1080];

// Commas are percent-encoded on purpose: srcset is a comma-delimited list, so a
// literal comma inside the Cloudflare option string breaks the whole attribute
// and no candidate loads at all. Cloudflare decodes %2C and serves the same bytes.
const url = (id: string, w: number) =>
  `https://posh.vip/cdn-cgi/image/width=${w}%2Cquality=75%2Cfit=scale-down%2Cformat=auto/https://images.posh.vip/originals/${id}`;

/**
 * Event flyer served straight from Posh's image CDN.
 *
 * A plain <img> rather than next/image on purpose: static export forces
 * `images.unoptimized`, which strips srcSet, so next/image would ship the same
 * 1080px file to every device — 346KB each, twelve of them in the archive.
 * Posh's CDN resizes on demand, so we build the srcSet ourselves and let the
 * browser pick by viewport and DPR (the 400w variant is 62KB).
 *
 * Fills its positioned parent, which owns the aspect ratio.
 */
export default function Flyer({
  id,
  alt,
  sizes,
  maxWidth,
  priority = false,
  className = "",
}: {
  id: string;
  alt: string;
  sizes: string;
  /** Cap the srcSet so the browser cannot pick a file larger than the slot needs. */
  maxWidth?: number;
  priority?: boolean;
  className?: string;
}) {
  const widths = WIDTHS.filter((w) => w <= (maxWidth ?? Infinity));
  return (
    // next/image cannot emit a srcSet under `images.unoptimized`; see note above.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url(id, widths[widths.length - 1])}
      srcSet={widths.map((w) => `${url(id, w)} ${w}w`).join(", ")}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
    />
  );
}
