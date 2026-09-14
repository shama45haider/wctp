import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live raffle · WECAMETOOPARTY",
  robots: { index: false, follow: false },
};

export default function RaffleLiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
