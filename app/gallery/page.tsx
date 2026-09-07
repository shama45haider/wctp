import type { Metadata } from "next";
import GalleryBoard from "@/components/GalleryBoard";
import { getInstagramPosts } from "@/lib/instagram";

export const metadata: Metadata = {
  title: "Gallery · WECAMETOOPARTY",
  description:
    "Every flyer WECAMETOOPARTY has made, and the feed from @wearethepartynyc.",
};

/**
 * Stays a server component for one reason, the same one app/page.tsx has:
 * getInstagramPosts reads data/instagram.json off disk at build time, and a
 * filesystem read cannot run in the browser.
 *
 * The walls themselves live in GalleryBoard, which has to be a client
 * component now - the photos come out of gallery_items in the browser, and an
 * admin edits them from the page rather than from the dashboard.
 */
export default function Gallery() {
  const posts = getInstagramPosts();
  return <GalleryBoard posts={posts} />;
}
