/**
 * Fetches every post from the WECAMETOOPARTY Instagram account and writes them
 * to data/instagram.json, which the site reads at build time.
 *
 * Requires two env vars:
 *   IG_USER_ID      the Instagram professional account's user id
 *   IG_ACCESS_TOKEN a long-lived access token with instagram_basic scope
 *
 * If either is missing this exits 0 without writing, so builds still succeed —
 * the site just renders its "not connected" state.
 *
 * Note: this needs a Business or Creator account. The old Basic Display API
 * that worked with personal accounts was shut down in December 2024.
 */
import fs from "node:fs";
import path from "node:path";

const USER_ID = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;

const OUT_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(OUT_DIR, "instagram.json");

const FIELDS = [
  "id",
  "permalink",
  "media_type",
  "media_url",
  "thumbnail_url",
  "caption",
  "timestamp",
].join(",");

if (!USER_ID || !TOKEN) {
  console.log(
    "[instagram] IG_USER_ID / IG_ACCESS_TOKEN not set — skipping fetch.",
  );
  process.exit(0);
}

const posts = [];
let url = `https://graph.instagram.com/v21.0/${USER_ID}/media?fields=${FIELDS}&limit=100&access_token=${TOKEN}`;

try {
  // Walk every page of the media edge so we get the full archive, not just p1.
  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
    }
    const json = await res.json();
    for (const m of json.data ?? []) {
      posts.push({
        id: m.id,
        permalink: m.permalink,
        mediaType: m.media_type,
        mediaUrl: m.media_url,
        thumbnailUrl: m.thumbnail_url,
        caption: m.caption,
        timestamp: m.timestamp,
      });
    }
    url = json.paging?.next ?? null;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2));
  console.log(`[instagram] wrote ${posts.length} posts to data/instagram.json`);
} catch (err) {
  // Never fail the build on a bad token or a rate limit; fall back to the
  // "not connected" state rather than taking the whole site down.
  console.error(`[instagram] fetch failed, continuing without posts: ${err}`);
  process.exit(0);
}
