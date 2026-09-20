import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The room",
  description: "Members' chat.",
  // Members only, and half of it is other people's pictures.
  robots: { index: false, follow: false },
};

export default function RoomLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
