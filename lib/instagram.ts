import fs from "node:fs";
import path from "node:path";

export type IgPost = {
  id: string;
  permalink: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  mediaUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  timestamp?: string;
};

/**
 * Posts are fetched at build time by scripts/fetch-instagram.mjs and written to
 * data/instagram.json. The file is gitignored and absent until the Instagram
 * API credentials are configured, in which case this returns an empty list and
 * the section renders its "not connected" state.
 */
export function getInstagramPosts(): IgPost[] {
  const file = path.join(process.cwd(), "data", "instagram.json");
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? (raw as IgPost[]) : [];
  } catch {
    return [];
  }
}
