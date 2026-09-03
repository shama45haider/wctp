import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ticket",
  description: "Scanned ticket details.",
  // A ticket carries a guest's name. It should never end up in an index.
  robots: { index: false, follow: false },
};

export default function PassLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
