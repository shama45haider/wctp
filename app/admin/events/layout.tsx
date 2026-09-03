import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Events",
  description: "Post and edit event listings.",
  // Drafts and the editing tool itself have no business in a search result,
  // and a crawler that finds this route will only ever see the refusal.
  robots: { index: false, follow: false },
};

export default function AdminEventsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
