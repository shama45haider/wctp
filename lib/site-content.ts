"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "./supabase";
import { ROLES, roster, type Artist, type Role } from "./artists";

/**
 * The two pages an admin edits in place: the team roster and the gallery.
 *
 * Both follow the shape lib/events-runtime.ts already established for the
 * date list. lib/artists.ts is compiled into the bundle and ships with the
 * page; public.team_members is read in the browser afterwards and merged on
 * top by slot, so the static roster is the floor rather than the ceiling and
 * a project with no database still draws a complete page. The gallery has no
 * static half at all - there was nowhere to put a photo of a night before
 * 0012 - so an empty table simply means an empty section.
 *
 * Every function returns rather than throws, for the same reason
 * lib/admin-data.ts does: these run on a phone at a door, and "the database
 * did not answer" has to survive all the way to the screen instead of
 * taking the page down with it.
 */

export type TeamMember = Artist & {
  /** True when a row in team_members decided this card, not the bundle. */
  fromDb: boolean;
  published: boolean;
};

export type GalleryItem = {
  id: string;
  imagePath: string;
  /** Public URL for imagePath, resolved through the site-images bucket. */
  imageUrl: string;
  caption: string | null;
  sort: number;
  published: boolean;
};

/** What an admin may change about one roster card. */
export type TeamPatch = {
  role?: Role;
  name?: string | null;
  title?: string | null;
  bio?: string | null;
  imagePath?: string | null;
  instagram?: string | null;
  soundcloud?: string | null;
  published?: boolean;
};

export type GalleryPatch = {
  caption?: string | null;
  sort?: number;
  published?: boolean;
};

type Outcome = { ok: boolean; error?: string };

const BUCKET = "site-images";
const TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** 8MB, matching what the age check accepts off a phone camera. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const NOT_CONNECTED = "Not connected.";
const UNREACHABLE = "The database did not answer.";
export const NEEDS_0012 =
  "This project has not run migration 0012 yet, so there is nowhere to save the team or the gallery.";

const TEAM_COLUMNS =
  "slot,role,name,title,bio,image_path,instagram,soundcloud,published";
const GALLERY_COLUMNS = "id,image_path,caption,sort,published";

/** PostgREST's wording for a table or column the schema does not have. */
function isMissingSchema(message: string) {
  return (
    /team_members|gallery_items|image_path/i.test(message) &&
    /does not exist|could not find|schema cache/i.test(message)
  );
}

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

/** `work`, or null if it has not answered inside `ms`. */
function capped<T>(work: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The public URL for anything in the site-images bucket. */
export function siteImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const supabase = safeClient();
  if (!supabase) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl ?? null;
}

/**
 * Puts an image in the bucket and returns its path.
 *
 * `folder` keeps team photos, gallery shots and event pictures apart, which
 * matters only for anyone reading the bucket by hand - the policy in 0012 is
 * is_admin() for the whole bucket rather than per folder.
 */
export async function uploadSiteImage(
  file: File,
  folder: "team" | "gallery" | "events",
): Promise<{ path?: string; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const looksLikeImage = file.type
    ? file.type.startsWith("image/")
    : /\.(jpe?g|png|heic|heif|webp|gif|avif)$/i.test(file.name);
  if (!looksLikeImage) return { error: "That is not an image." };

  if (file.size > MAX_IMAGE_BYTES) {
    return {
      error: `That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB, and the limit is 8 MB.`,
    };
  }

  const ext = (file.name.split(".").pop() ?? "jpg")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 5)
    .toLowerCase();
  // A timestamp rather than a fixed name, so a replacement is never served
  // out of a cache of the picture it replaced.
  const path = `${folder}/${Date.now()}.${ext || "jpg"}`;

  const up = await capped(
    supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    }),
    UPLOAD_TIMEOUT_MS,
  );

  if (!up) return { error: "The upload did not finish. Nothing was saved." };
  if (up.error) {
    if (/bucket/i.test(up.error.message) && /not found/i.test(up.error.message)) {
      return { error: NEEDS_0012 };
    }
    return { error: up.error.message };
  }
  return { path };
}

/* ------------------------------------------------------------------ team -- */

type TeamRecord = {
  slot: number;
  role: string | null;
  name: string | null;
  title: string | null;
  bio: string | null;
  image_path: string | null;
  instagram: string | null;
  soundcloud: string | null;
  published: boolean | null;
};

// Read off ROLES rather than listed again, so a section added there is never
// quietly filed back under "artist" when its cards load.
const ROLES_SET = new Set<Role>(ROLES.map((r) => r.id));
const asRole = (raw: string | null): Role =>
  raw && ROLES_SET.has(raw as Role) ? (raw as Role) : "artist";

/**
 * The roster as the page should draw it: the bundled list with any row from
 * team_members laid over the slot it names, plus any slot the bundle does
 * not have at all.
 *
 * Unpublished slots are returned rather than dropped, carrying `published:
 * false` so the page can decide. Filtering them out here read well until you
 * follow it through: hiding a card would also hide the only control that
 * could ever bring it back, so an admin would have to go to the SQL editor
 * to undo a mis-tap. TeamBoard hides them from guests and shows them to
 * admins with a badge, the same way GalleryBoard treats a hidden photo.
 */
function mergeTeam(rows: TeamRecord[]): TeamMember[] {
  const fromDb = new Map<number, TeamRecord>();
  for (const row of rows) {
    if (typeof row.slot === "number") fromDb.set(row.slot, row);
  }

  const asMember = (row: TeamRecord, base?: Artist): TeamMember => ({
    slot: row.slot,
    role: asRole(row.role),
    name: row.name?.trim() || undefined,
    title: row.title?.trim() || undefined,
    bio: row.bio?.trim() || undefined,
    imageUrl: siteImageUrl(row.image_path) ?? base?.imageUrl,
    instagram: row.instagram?.trim() || undefined,
    soundcloud: row.soundcloud?.trim() || undefined,
    fromDb: true,
    published: row.published !== false,
  });

  const merged: TeamMember[] = [];
  for (const seed of roster) {
    const row = fromDb.get(seed.slot);
    merged.push(
      row
        ? asMember(row, seed)
        : { ...seed, fromDb: false, published: true },
    );
  }

  const seeded = new Set(roster.map((a) => a.slot));
  for (const row of fromDb.values()) {
    if (!seeded.has(row.slot)) merged.push(asMember(row));
  }

  return merged.sort((a, b) => a.slot - b.slot);
}

export async function listTeam(): Promise<{
  members: TeamMember[];
  error?: string;
}> {
  const supabase = safeClient();
  // No client is not a failure worth showing: the bundled roster is a whole
  // page on its own, and always was.
  if (!supabase) return { members: mergeTeam([]) };

  const res = await capped(
    supabase.from("team_members").select(TEAM_COLUMNS).order("slot"),
    TIMEOUT_MS,
  );
  if (!res) return { members: mergeTeam([]), error: UNREACHABLE };
  if (res.error) {
    return {
      members: mergeTeam([]),
      error: isMissingSchema(res.error.message) ? NEEDS_0012 : res.error.message,
    };
  }
  return { members: mergeTeam((res.data ?? []) as unknown as TeamRecord[]) };
}

/**
 * Writes one card. An upsert rather than an update: most slots have never
 * had a row, since the bundle was the only thing that ever filled them in.
 */
export async function saveTeamMember(
  slot: number,
  patch: TeamPatch,
): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const row: Record<string, unknown> = { slot, updated_at: new Date().toISOString() };
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.name !== undefined) row.name = patch.name?.trim() || null;
  if (patch.title !== undefined) row.title = patch.title?.trim() || null;
  if (patch.bio !== undefined) row.bio = patch.bio?.trim() || null;
  if (patch.imagePath !== undefined) row.image_path = patch.imagePath;
  if (patch.instagram !== undefined) row.instagram = patch.instagram?.trim() || null;
  if (patch.soundcloud !== undefined) row.soundcloud = patch.soundcloud?.trim() || null;
  if (patch.published !== undefined) row.published = patch.published;

  const res = await capped(
    supabase.from("team_members").upsert(row, { onConflict: "slot" }).select("slot"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) {
    return {
      ok: false,
      error: isMissingSchema(res.error.message) ? NEEDS_0012 : res.error.message,
    };
  }
  // A write a policy refuses changes nothing and says nothing about it.
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing saved - this account is not an admin." };
  }
  return { ok: true };
}

/**
 * Drops the row, which hands the slot back to whatever the bundle says for
 * it - the way to undo an edit rather than to remove a person. Hiding
 * someone for good is `published: false`.
 */
export async function resetTeamMember(slot: number): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase.from("team_members").delete().eq("slot", slot).select("slot"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) {
    return {
      ok: false,
      error: isMissingSchema(res.error.message) ? NEEDS_0012 : res.error.message,
    };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- gallery -- */

type GalleryRecord = {
  id: string;
  image_path: string;
  caption: string | null;
  sort: number | null;
  published: boolean | null;
};

const toGallery = (r: GalleryRecord): GalleryItem => ({
  id: r.id,
  imagePath: r.image_path,
  imageUrl: siteImageUrl(r.image_path) ?? "",
  caption: r.caption,
  sort: r.sort ?? 0,
  published: r.published !== false,
});

export async function listGallery(): Promise<{
  items: GalleryItem[];
  error?: string;
}> {
  const supabase = safeClient();
  if (!supabase) return { items: [] };

  const res = await capped(
    supabase
      .from("gallery_items")
      .select(GALLERY_COLUMNS)
      .order("sort", { ascending: true })
      .order("created_at", { ascending: false }),
    TIMEOUT_MS,
  );
  if (!res) return { items: [], error: UNREACHABLE };
  if (res.error) {
    return {
      items: [],
      error: isMissingSchema(res.error.message) ? NEEDS_0012 : res.error.message,
    };
  }
  // A row whose image never resolved is a broken tile, which is worse on a
  // gallery than one fewer photo.
  return {
    items: ((res.data ?? []) as unknown as GalleryRecord[])
      .map(toGallery)
      .filter((i) => i.imageUrl),
  };
}

export async function addGalleryItem(
  imagePath: string,
  caption?: string,
): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase
      .from("gallery_items")
      .insert({ image_path: imagePath, caption: caption?.trim() || null })
      .select("id"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) {
    return {
      ok: false,
      error: isMissingSchema(res.error.message) ? NEEDS_0012 : res.error.message,
    };
  }
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing saved - this account is not an admin." };
  }
  return { ok: true };
}

export async function updateGalleryItem(
  id: string,
  patch: GalleryPatch,
): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const row: Record<string, unknown> = {};
  if (patch.caption !== undefined) row.caption = patch.caption?.trim() || null;
  if (patch.sort !== undefined) row.sort = patch.sort;
  if (patch.published !== undefined) row.published = patch.published;
  if (Object.keys(row).length === 0) return { ok: true };

  const res = await capped(
    supabase.from("gallery_items").update(row).eq("id", id).select("id"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: res.error.message };
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing saved - this account is not an admin." };
  }
  return { ok: true };
}

/**
 * Removes the row and then the file behind it. In that order on purpose: a
 * row pointing at a deleted file is a broken tile on a public page, while a
 * file with no row is only bytes nobody looks at.
 */
export async function deleteGalleryItem(
  id: string,
  imagePath: string,
): Promise<Outcome> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const res = await capped(
    supabase.from("gallery_items").delete().eq("id", id).select("id"),
    TIMEOUT_MS,
  );
  if (!res) return { ok: false, error: UNREACHABLE };
  if (res.error) return { ok: false, error: res.error.message };
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing removed - this account is not an admin." };
  }

  // Best effort. The tile is already gone from the page either way.
  await capped(supabase.storage.from(BUCKET).remove([imagePath]), TIMEOUT_MS);
  return { ok: true };
}

/* ----------------------------------------------------------------- hooks -- */

export type TeamList = {
  ready: boolean;
  members: TeamMember[];
  error: string | null;
  reload: () => void;
};

/**
 * The roster, bundled list first and any saved edits laid over it once they
 * arrive. Seeded with the static roster so the first paint is the finished
 * page - the same reason useRuntimeEvents seeds itself with allEvents - and
 * `ready` only says whether the database has answered, not whether there is
 * anything to draw.
 */
export function useTeam(): TeamList {
  const [state, setState] = useState<{ members: TeamMember[]; error: string | null } | null>(
    null,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void listTeam().then(({ members, error }) => {
      if (live) setState({ members, error: error ?? null });
    });
    return () => {
      live = false;
    };
  }, [tick]);

  const seeded = useMemo<TeamMember[]>(
    () => roster.map((a) => ({ ...a, fromDb: false, published: true })),
    [],
  );

  return {
    ready: state !== null,
    members: state?.members ?? seeded,
    error: state?.error ?? null,
    reload: useCallback(() => setTick((t) => t + 1), []),
  };
}

export type GalleryList = {
  ready: boolean;
  items: GalleryItem[];
  error: string | null;
  reload: () => void;
};

export function useGallery(): GalleryList {
  const [state, setState] = useState<{ items: GalleryItem[]; error: string | null } | null>(
    null,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void listGallery().then(({ items, error }) => {
      if (live) setState({ items, error: error ?? null });
    });
    return () => {
      live = false;
    };
  }, [tick]);

  return {
    ready: state !== null,
    items: state?.items ?? [],
    error: state?.error ?? null,
    reload: useCallback(() => setTick((t) => t + 1), []),
  };
}
