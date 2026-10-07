import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get tickets · WECAMETOOPARTY",
  description: "Tickets for the next WECAMETOOPARTY date.",
  // A hand-off to checkout, not a page of its own.
  robots: { index: false, follow: true },
};

export default function BuyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
