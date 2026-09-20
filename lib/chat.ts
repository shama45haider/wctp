"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

/**
 * The room.
 *
 * Reads go through chat_recent() in 0022, because a plain join to profiles
 * returns nothing for other people's rows. Writes go straight at the table,
 * where the policy decides whether this account is allowed to talk - the
 * component's own check is a courtesy so the box can say why, not the gate.
 *
 * This is the first thing on the site to use Supabase Realtime rather than
 * polling. A chat that polls is either late or expensive, and the raffle's
 * one-second loop is affordable only because one person watches it.
 */

export type ChatMessage = {
  id: string;
  userId: string;
  handle: string;
  avatarPath: string | null;
  body: string | null;
  imagePath: string | null;
  gifUrl: string | null;
  createdAt: string;
};

const BUCKET = "chat-images";
const NOT_CONNECTED = "Not connected.";
const UNREACHABLE = "That took too long.";
const TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** Matches the body cap in 0022. */
export const MAX_BODY = 600;
/** Same ceiling the rest of the site uses for an upload off a phone. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const NEEDS_0022 =
  "This project has not run migration 0022 yet, so the room does not exist.";

const NO_RELATION = /does not exist|could not find|schema cache/i;
const IS_CHAT = /chat_messages|chat_recent|chat-images/i;

function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

async function capped<T>(work: PromiseLike<T>, ms = TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function explain(message: string): string {
  if (IS_CHAT.test(message) && NO_RELATION.test(message)) return NEEDS_0022;
  if (/Slow down/i.test(message)) return "Slow down a second.";
  if (/chat_has_content/i.test(message)) return "Say something first.";
  if (/chat_gif_host/i.test(message)) return "That is not a Giphy link.";
  if (/row-level security|violates row-level/i.test(message)) {
    return "Only age-verified members can post.";
  }
  return message;
}

/** The public URL for a picture somebody posted. */
export function chatImageUrl(path: string | null): string | null {
  if (!path) return null;
  const supabase = safeClient();
  if (!supabase) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl ?? null;
}

const toMessage = (r: {
  id: string;
  user_id: string;
  handle: string;
  avatar_path: string | null;
  body: string | null;
  image_path: string | null;
  gif_url: string | null;
  created_at: string;
}): ChatMessage => ({
  id: r.id,
  userId: r.user_id,
  handle: r.handle,
  avatarPath: r.avatar_path,
  body: r.body,
  imagePath: r.image_path,
  gifUrl: r.gif_url,
  createdAt: r.created_at,
});

/** The last stretch of the room, oldest first for drawing. */
export async function recentMessages(
  limit = 100,
): Promise<{ rows: ChatMessage[]; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { rows: [], error: NOT_CONNECTED };

  const res = await capped(supabase.rpc("chat_recent", { p_limit: limit }));
  if (!res) return { rows: [], error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { rows: [], error: explain(error.message) };

  // chat_recent returns newest first so the LIMIT takes the right end; a
  // transcript reads the other way round.
  const rows = ((data ?? []) as Parameters<typeof toMessage>[0][])
    .map(toMessage)
    .reverse();
  return { rows };
}

export async function sendMessage(input: {
  body?: string;
  imagePath?: string | null;
  gifUrl?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const body = input.body?.trim() ?? "";
  if (!body && !input.imagePath && !input.gifUrl) {
    return { ok: false, error: "Say something first." };
  }
  if (body.length > MAX_BODY) return { ok: false, error: "That is too long." };

  const session = await capped(supabase.auth.getSession());
  const me = session?.data.session?.user.id;
  if (!me) return { ok: false, error: "Sign in first." };

  const res = await capped(
    supabase.from("chat_messages").insert({
      user_id: me,
      body: body || null,
      image_path: input.imagePath ?? null,
      gif_url: input.gifUrl ?? null,
    }),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { error } = res;
  return error ? { ok: false, error: explain(error.message) } : { ok: true };
}

/**
 * Take a message back.
 *
 * An update, not a delete: 0022 keeps the row and stamps who hid it, so a
 * moderator can still see what was removed rather than watching an argument
 * develop holes.
 */
export async function hideMessage(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { ok: false, error: NOT_CONNECTED };

  const session = await capped(supabase.auth.getSession());
  const me = session?.data.session?.user.id;
  if (!me) return { ok: false, error: "Sign in first." };

  const res = await capped(
    supabase
      .from("chat_messages")
      .update({ hidden_at: new Date().toISOString(), hidden_by: me })
      .eq("id", id)
      .select("id"),
  );
  if (!res) return { ok: false, error: UNREACHABLE };

  const { data, error } = res;
  if (error) return { ok: false, error: explain(error.message) };
  if (((data ?? []) as unknown[]).length === 0) {
    return { ok: false, error: "That is not yours to remove." };
  }
  return { ok: true };
}

/** Puts a picture in the bucket and hands back its path. */
export async function uploadChatImage(
  file: File,
): Promise<{ path?: string; error?: string }> {
  const supabase = safeClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const looksLikeImage = file.type
    ? file.type.startsWith("image/")
    : /\.(jpe?g|png|heic|heif|webp|gif|avif)$/i.test(file.name);
  if (!looksLikeImage) return { error: "That is not an image." };
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      error: `That is ${(file.size / (1024 * 1024)).toFixed(1)} MB, and 8 MB is the limit.`,
    };
  }

  const session = await capped(supabase.auth.getSession());
  const me = session?.data.session?.user.id;
  if (!me) return { error: "Sign in first." };

  const ext = (file.name.split(".").pop() ?? "jpg")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 5)
    .toLowerCase();
  // The folder has to be this account's own id - the storage policy in 0022
  // checks it, so a path cannot be dressed up as somebody else's.
  const path = `${me}/${Date.now()}.${ext || "jpg"}`;

  const up = await capped(
    supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    }),
    UPLOAD_TIMEOUT_MS,
  );
  if (!up) return { error: UNREACHABLE };
  if (up.error) return { error: explain(up.error.message) };

  return { path };
}

/**
 * Watch the room.
 *
 * postgres_changes gives an insert the moment it lands, but only the raw row -
 * no handle, no picture, because the payload is the table and not the function.
 * Rather than join per message, `onInsert` is handed the id and the caller
 * re-reads; at chat volumes that is one small round trip and it keeps one
 * code path building a message instead of two that have to agree.
 */
export function watchRoom(onInsert: () => void): RealtimeChannel | null {
  const supabase = safeClient();
  if (!supabase) return null;

  return supabase
    .channel("room")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages" },
      () => onInsert(),
    )
    .subscribe();
}

export function stopWatching(channel: RealtimeChannel | null) {
  if (!channel) return;
  const supabase = safeClient();
  void supabase?.removeChannel(channel);
}
