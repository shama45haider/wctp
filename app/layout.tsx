import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import Confetti from "@/components/Confetti";
import TabBar from "@/components/TabBar";
import Raffle from "@/components/Raffle";
import ServiceWorker from "@/components/ServiceWorker";
import { CopyProvider } from "@/components/Editable";
import { SITE_ORIGIN } from "@/lib/events";

const display = Big_Shoulders({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["700", "900"],
});

const body = Archivo({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = Martian_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const viewport: Viewport = {
  themeColor: "#050505",
  colorScheme: "dark",
  // Lets the page paint under a phone's notch and home indicator; the nav and
  // tab bar pad themselves back in with env(safe-area-inset-*).
  viewportFit: "cover",
};

export const metadata: Metadata = {
  // Resolves the relative URLs below (and in every page's openGraph) against
  // the real domain - link-preview crawlers need absolute ones.
  metadataBase: new URL(SITE_ORIGIN),
  title: "WECAMETOOPARTY",
  applicationName: "WECAMETOOPARTY",
  description:
    "Nights in New York City. 42 events, 4,342 people. RSVP and the address lands in your inbox.",
  // Without these a crawler guesses from the first big <img> on the page.
  // Pages with a flyer to show (home, tickets, events) override them.
  openGraph: {
    type: "website",
    siteName: "WECAMETOOPARTY",
    url: "/",
    title: "WECAMETOOPARTY",
    description:
      "Nights in New York City. 42 events, 4,342 people. RSVP and the address lands in your inbox.",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
  },
  twitter: { card: "summary" },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "WCTP",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-scroll-behavior: globals.css scrolls smoothly for in-page anchors,
    // and without this Next 16 would also smooth-scroll every page change back
    // to the top instead of jumping there.
    <html lang="en" data-scroll-behavior="smooth">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} pr-[env(safe-area-inset-right)] pb-[calc(3.75rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] lg:pb-0`}
      >
        <Particles />
        <Confetti />
        <CopyProvider>
          <Nav />
          {children}
          <Footer />
          <TabBar />
          <Raffle />
        </CopyProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
