import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A link to one event's page, or the same content unlinked when the static
 * export has no page for it.
 *
 * app/events/[slug] prerenders the events known when the site was built and
 * has `dynamicParams = false`. The lists read the events table live, so a date
 * published since then is listed before its page exists - linking it, or
 * letting next/link prefetch it, is a 404. It reads as plain text until the
 * next scheduled rebuild gives it a page.
 */
export default function EventLink({
  slug,
  hash,
  hasPage,
  externalHref,
  className,
  children,
}: {
  slug: string;
  /** Without the "#". */
  hash?: string;
  hasPage: boolean;
  /**
   * Somewhere else entirely, for a date whose tickets are sold off-site. When
   * set it wins over the event page: the flyer is the thing people tap to buy,
   * and making them land on a page whose only content is another link out is a
   * step that exists for no one's benefit.
   */
  externalHref?: string | null;
  className?: string;
  children: ReactNode;
}) {
  if (externalHref) {
    return (
      <a
        href={externalHref}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }
  if (!hasPage) return <span className={className}>{children}</span>;
  return (
    <Link href={`/events/${slug}${hash ? `#${hash}` : ""}`} className={className}>
      {children}
    </Link>
  );
}
