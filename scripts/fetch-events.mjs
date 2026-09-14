/**
 * Builds data/events.json, which lib/share-events.ts reads at build time.
 *
 * Events published from the admin dashboard live in Supabase `public.events`
 * and are otherwise only ever merged in the browser (lib/events-runtime.ts).
 * Link-preview crawlers run no JavaScript, so without this a dashboard-only
 * date could never be the flyer a shared link shows.
 *
 * Read with the public anon key, the same one the browser uses - row-level
 * security decides what it can see, and only published rows are asked for.
 *
 * Never fails the build. Missing variables or any error writes an empty list,
 * and the site falls back to the events built into lib/events.ts.
 */
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const OUT_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(OUT_DIR, "events.json");

const COLUMNS = ["slug", "title", "date", "time", "dow", "flyer_url", "blurb"].join(",");

function write(rows, how) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(rows, null, 2));
  console.log(`[events] wrote ${rows.length} event(s) from ${how}`);
}

async function fromSupabase() {
  const url = `${SUPABASE_URL}/rest/v1/events?select=${COLUMNS}&published=eq.true&order=date.asc`;
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} - ${await res.text()}`);
  }
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("the response was not a list");
  return json;
}

try {
  if (SUPABASE_URL && ANON_KEY) {
    write(await fromSupabase(), "Supabase");
  } else {
    console.log(
      "[events] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set - only the built-in events will be used.",
    );
    write([], "nothing (not configured)");
  }
} catch (err) {
  // A paused project or a rotated key should cost link previews their
  // dashboard-only dates, not the deploy.
  console.error(`[events] failed, continuing with built-in events only: ${err.message}`);
  write([], "nothing (the fetch failed)");
}
