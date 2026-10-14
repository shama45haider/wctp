/**
 * A ticker on a solid red band: white display type sliding right to left, each
 * phrase divided from the next by a slash. Hovering pauses it so a visitor can
 * read a phrase. The list is drawn twice so the -50% loop in .marquee-track has
 * no seam; the second copy is hidden from screen readers. Reduced-motion
 * visitors get the global rule that stops the track.
 */
export default function TextCarousel({ items }: { items: string[] }) {
  const row = (hidden: boolean) => (
    <div className="flex shrink-0" aria-hidden={hidden}>
      {items.map((text) => (
        <span key={text} className="flex items-center gap-6 pr-6 whitespace-nowrap">
          <span className="font-display text-[clamp(1rem,3vw,1.25rem)] leading-none tracking-[0.02em] uppercase text-white">
            {text}
          </span>
          <span aria-hidden className="font-display text-[1.25rem] leading-none text-white/50">
            /
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="group overflow-hidden bg-blood py-2.5" role="region" aria-label="What happens here">
      <div className="marquee-track group-hover:[animation-play-state:paused]">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
