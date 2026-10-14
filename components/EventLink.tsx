"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { stabTo } from "./StabTransition";

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
  stab = false,
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
  /** A flyer: the click plays the knife-and-blood transition before the page opens. */
  stab?: boolean;
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
  const href = `/events/${slug}${hash ? `#${hash}` : ""}`;
  if (stab) {
    return (
      <Link
        href={href}
        className={className}
        onClick={(e) => {
          // Leave modified clicks (new tab, etc.) to the browser.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          // Keyboard activation reports no pointer position: start from the middle.
          const x = e.clientX || window.innerWidth / 2;
          const y = e.clientY || window.innerHeight / 2;
          stabTo(href, x, y);
        }}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
