"use client";

import { getSupabase } from "./supabase";

/**
 * Asks the send-email function to put one message through Resend.
 *
 * Nothing here holds an API key, and that is the point. This site is a
 * static export: anything a page imports ends up in the bundle every visitor
 * downloads, so a key on this side would be readable in devtools and usable
 * by anyone who looked. The key sits on the Deno function instead - see
 * supabase/functions/send-email/index.ts - and this only carries the
 * message to it, over the caller's own session.
 *
 * That function refuses anyone who is not in the admins table, so this
 * fails for a guest by design rather than by accident. Returns rather than
 * throws, like the rest of lib/: a send that did not go through is
 * something to put on the screen, not something to take a page down with.
 */

export type Email = {
  to: string | string[];
  subject: string;
  /** At least one of html or text. */
  html?: string;
  text?: string;
};

type Outcome = { ok: boolean; id?: string; error?: string };

/** Long enough for a cold start on a function nobody has called today. */
const TIMEOUT_MS = 20_000;

export async function sendEmail(message: Email): Promise<Outcome> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    supabase = null;
  }
  if (!supabase) return { ok: false, error: "Not connected." };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = supabase.functions.invoke<{ id?: string; error?: string }>(
      "send-email",
      { body: message },
    );
    const capped = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });

    const res = await Promise.race([call, capped]);
    if (!res) return { ok: false, error: "The mailer did not answer." };

    // invoke() reports a non-2xx as an error whose body still holds the
    // sentence the function wrote, which is the half worth showing.
    if (res.error) {
      const detail = await readError(res.error);
      return { ok: false, error: detail ?? res.error.message };
    }
    if (res.data?.error) return { ok: false, error: res.data.error };
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "The email did not send.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The function's own message out of a FunctionsHttpError, when there is one. */
async function readError(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.json();
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}
