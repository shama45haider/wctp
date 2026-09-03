/**
 * Builds data/instagram.json, which the home page reads at build time.
 *
 * Two sources, tried in order.
 *
 * 1. The Instagram Graph API, when IG_USER_ID and IG_ACCESS_TOKEN are set.
 *    This is the only way to get posts automatically and keep them current,
 *    and it needs a Business or Creator account linked to a Facebook page.
 *
 * 2. Otherwise data/instagram-posts.json, a hand-kept list pointing at image
 *    files committed under public/instagram/.
 *
 * There is deliberately no third option that reads the public site without
 * credentials, because none exists any more. The oEmbed endpoint has needed an
 * app token since 2020 and now answers with HTML; the profile page carries no
 * post data in its markup, only a client-rendered shell; and the /embed/ URL
 * returns that same shell byte for byte whether the shortcode is real or
 * invented. Anything built on those looks like it works and quietly produces
 * nothing, which is exactly what happened here before.
 */
import fs from "node:fs";
import path from "node:path";

const USER_ID = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;

const OUT_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(OUT_DIR, "instagram.json");
const MANUAL_FILE = path.join(OUT_DIR, "instagram-posts.json");
const IMAGE_DIR = path.join(process.cwd(), "public", "instagram");

const FIELDS = [
  "id",
  "permalink",
  "media_type",
  "media_url",
  "thumbnail_url",
  "caption",
  "timestamp",
].join(",");

function write(posts, how) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2));
  console.log(`[instagram] wrote ${posts.length} post(s) from ${how}`);
}

/** Every page of the media edge, so the archive comes back whole. */
async function fromGraphApi() {
  const posts = [];
  let url = `https://graph.instagram.com/v21.0/${USER_ID}/media?fields=${FIELDS}&limit=100&access_token=${TOKEN}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} - ${await res.text()}`);
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
  return posts;
}

/**
 * The hand-kept list.
 *
 * Entries point at files in public/instagram rather than at Instagram's CDN:
 * those URLs carry an expiring signature and would go dead within days, which
 * is the failure that is hardest to notice because the build still passes.
 */
function fromLocalFiles() {
  if (!fs.existsSync(MANUAL_FILE)) return [];

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(MANUAL_FILE, "utf8"));
  } catch (err) {
    console.error(`[instagram] ${MANUAL_FILE} is not valid JSON: ${err.message}`);
    return [];
  }
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const posts = [];
  for (const [i, e] of entries.entries()) {
    if (!e?.file) {
      console.warn(`[instagram] entry ${i} has no "file" - skipped`);
      continue;
    }
    // A missing image renders as a broken square, which reads as a bug in the
    // site rather than a typo in this list. Say so at build time instead.
    if (!fs.existsSync(path.join(IMAGE_DIR, e.file))) {
      console.warn(`[instagram] public/instagram/${e.file} not found - skipped`);
      continue;
    }
    posts.push({
      id: e.file,
      permalink: e.permalink ?? "https://www.instagram.com/wearethepartynyc/",
      mediaType: e.video ? "VIDEO" : "IMAGE",
      mediaUrl: `/instagram/${e.file}`,
      thumbnailUrl: `/instagram/${e.file}`,
      caption: e.caption ?? "",
      timestamp: e.timestamp,
    });
  }
  return posts;
}

try {
  if (USER_ID && TOKEN) {
    write(await fromGraphApi(), "the Instagram Graph API");
  } else {
    const local = fromLocalFiles();
    if (local.length === 0) {
      console.log(
        "[instagram] no credentials and no usable entries in data/instagram-posts.json - the feed section will render its empty state.",
      );
    }
    write(local, "data/instagram-posts.json");
  }
} catch (err) {
  // Never take the site down over the feed. An expired token or a rate limit
  // should cost the grid, not the build.
  console.error(`[instagram] failed, continuing without posts: ${err.message}`);
  write([], "nothing (the fetch failed)");
}
