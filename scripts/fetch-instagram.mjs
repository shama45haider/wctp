/**
 * Stub for Instagram posts. Manually curate post shortcodes in data/instagram-posts.json
 * and this will convert them to embed data.
 *
 * To add posts: edit data/instagram-posts.json and add shortcodes (the 11-char ID from
 * instagram.com/p/SHORTCODE/). This script fetches metadata for each using Instagram's
 * public oEmbed API (no authentication needed).
 */
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(OUT_DIR, "instagram.json");
const POSTS_FILE = path.join(OUT_DIR, "instagram-posts.json");

/**
 * Get embed data for an Instagram post using the public oEmbed API.
 * No authentication needed for public posts.
 */
async function getPostEmbed(postShortcode) {
  try {
    const oembedUrl = `https://www.instagram.com/oembed/?url=https://www.instagram.com/p/${postShortcode}/`;
    const res = await fetch(oembedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      // Instagram returns 404 HTML for invalid posts
      return null;
    }
    const text = await res.text();
    if (!text.startsWith("{")) {
      // Response is HTML, not JSON (post doesn't exist or is private)
      return null;
    }
    const data = JSON.parse(text);
    return {
      title: data.title || "",
      thumbnail_url: data.thumbnail_url || "",
      media_type: "image",
    };
  } catch (err) {
    // Silently fail — post shortcode may be invalid
    return null;
  }
}

async function buildInstagramPosts() {
  try {
    // If no manual posts file exists, create an empty one
    if (!fs.existsSync(POSTS_FILE)) {
      console.log(
        "[instagram] data/instagram-posts.json not found. Create it with post shortcodes to embed.",
      );
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(POSTS_FILE, JSON.stringify([], null, 2));
      fs.writeFileSync(OUT_FILE, JSON.stringify([], null, 2));
      return;
    }

    const shortcodes = JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
    if (!Array.isArray(shortcodes) || shortcodes.length === 0) {
      console.log(
        "[instagram] data/instagram-posts.json is empty. Add shortcodes to embed posts.",
      );
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(OUT_FILE, JSON.stringify([], null, 2));
      return;
    }

    console.log(`[instagram] processing ${shortcodes.length} post(s)...`);

    const posts = [];
    for (const shortcode of shortcodes) {
      // Delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 300));

      const embedData = await getPostEmbed(shortcode);
      if (embedData) {
        posts.push({
          id: shortcode,
          permalink: `https://www.instagram.com/p/${shortcode}/`,
          mediaType: "IMAGE",
          mediaUrl: `https://www.instagram.com/p/${shortcode}/`,
          thumbnailUrl: embedData.thumbnail_url,
          caption: embedData.title,
          timestamp: new Date().toISOString(),
        });
        console.log(`  ✓ ${shortcode}`);
      } else {
        console.log(`  ✗ ${shortcode} (oEmbed failed)`);
      }
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2));
    console.log(
      `[instagram] wrote ${posts.length}/${shortcodes.length} posts to data/instagram.json`,
    );
  } catch (err) {
    // Never fail the build
    console.error(`[instagram] error: ${err.message}`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify([], null, 2));
  }
}

await buildInstagramPosts();
