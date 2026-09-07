import type { Metadata } from "next";
import TicketsPageBody from "@/components/TicketsPageBody";

export const metadata: Metadata = {
  title: "Tickets · WECAMETOOPARTY",
  description:
    "Every WECAMETOOPARTY date on sale in New York City. Free RSVPs, paid tiers and tables. Every RSVP needs an account with a verified age; the address is emailed to the list before the night.",
};

/**
 * Stays a server component for the metadata export above, which a client
 * component cannot have. Everything else - the facts strip, the browsable
 * grid, the door steps - lives in TicketsPageBody, which needs to be a
 * client component to ask the visitor's own clock what day it is.
 */
export default function TicketsPage() {
  return <TicketsPageBody />;
}
