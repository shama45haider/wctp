import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prize pickup",
  description: "Hand over a prize bought from the store.",
  // Opens with a buyer's claim code in the fragment. Never worth indexing.
  robots: { index: false, follow: false },
};

export default function ClaimLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
