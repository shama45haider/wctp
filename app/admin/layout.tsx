import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  description: "Door tools.",
  // Everything under /admin is either a refusal or a roster of guests. Neither
  // belongs in a search result, and the nested layouts inherit this.
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
