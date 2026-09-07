import HomeContent from "@/components/HomeContent";
import { getInstagramPosts } from "@/lib/instagram";

/**
 * Stays a server component for exactly one reason: getInstagramPosts reads
 * data/instagram.json off disk at build time, and a filesystem read cannot
 * run in the browser. Everything that depends on which night is next - the
 * hero, the marquee, the Upcoming and Archive sections - lives in
 * HomeContent instead, which needs to be a client component so it can ask
 * the visitor's own clock what day it actually is. See lib/now.ts.
 */
export default function Home() {
  const posts = getInstagramPosts();
  return <HomeContent posts={posts} />;
}
