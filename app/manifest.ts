import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WECAMETOOPARTY",
    short_name: "WCTP",
    description: "Nights in New York City. RSVP and the address lands in your inbox.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050505",
    theme_color: "#050505",
    categories: ["entertainment", "events", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Tickets", url: "/tickets/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Your tickets", url: "/account/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
