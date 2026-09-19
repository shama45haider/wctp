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
  className,
  children,
}: {
  slug: string;
  /** Without the "#". */
  hash?: string;
  hasPage: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!hasPage) return <span className={className}>{children}</span>;
  return (
    <Link href={`/events/${slug}${hash ? `#${hash}` : ""}`} className={className}>
      {children}
    </Link>
  );
}
