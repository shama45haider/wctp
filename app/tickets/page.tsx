import type { Metadata } from "next";
import TicketsPageBody from "@/components/TicketsPageBody";
import {
  eventPageSlugs,
  eventShareMetadata,
  nextEventForSharing,
  nextUpDescription,
} from "@/lib/share-events";

/** People share /tickets too, so it previews with the next event's flyer, like the home page. */
export function generateMetadata(): Metadata {
  const next = nextEventForSharing();
  return {
    title: "Tickets · WECAMETOOPARTY",
    description:
      "Every WECAMETOOPARTY date on sale in New York City. Free RSVPs, paid tiers and tables. Every RSVP needs an account with a verified age; the address is emailed to the list before the night.",
    ...(next
      ? eventShareMetadata({
          event: next,
          url: "/tickets/",
          title: `${next.title} · WECAMETOOPARTY`,
          description: nextUpDescription(next),
        })
      : {}),
  };
}

/**
 * Stays a server component for the metadata export above, which a client
 * component cannot have. Everything else - the next-up line, the browsable
 * grid, the door steps - lives in TicketsPageBody, which needs to be a
 * client component to ask the visitor's own clock what day it is.
 */
export default function TicketsPage() {
  return <TicketsPageBody pageSlugs={eventPageSlugs()} />;
}
