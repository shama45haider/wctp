import type { Metadata } from "next";
import HomeContent from "@/components/HomeContent";
import {
  eventShareMetadata,
  nextEventForSharing,
  nextUpDescription,
} from "@/lib/share-events";

/**
 * The link preview for the home page is the next event's flyer, decided at
 * build time (see lib/share-events.ts). With nothing upcoming, the root
 * layout's site-wide defaults apply.
 */
export function generateMetadata(): Metadata {
  const next = nextEventForSharing();
  if (!next) return {};
  return eventShareMetadata({
    event: next,
    url: "/",
    title: `${next.title} · WECAMETOOPARTY`,
    description: nextUpDescription(next),
  });
}

export default function Home() {
  return <HomeContent />;
}
