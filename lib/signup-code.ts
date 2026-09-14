"use client";

import { getSupabase } from "./supabase";

/**
 * The two calls behind proving an email before an account exists for it -
 * see supabase/migrations/0013_verify_email_before_signup.sql for why this
 * has to happen before signUp() rather than after.
 *
 * Both talk to Edge Functions rather than a table directly, because there
 * is no table policy that would let them: signup_codes grants nothing to
 * anon or authenticated on purpose, so "has this address answered a code we
 * sent" is a question only the functions - holding the service role key -
 * can honestly answer. Neither call carries a session, because at this
 * point in signing up there is not one yet.
 */

type Outcome = { ok: boolean; error?: string };

const TIMEOUT_MS = 20_000;

async function call(fn: string, body: Record<string, string>): Promise<Outcome> {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    supabase = null;
  }
  if (!supabase) return { ok: false, error: "Not connected." };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const req = supabase.functions.invoke<{ ok?: boolean; error?: string }>(fn, { body });
    const capped = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });

    const res = await Promise.race([req, capped]);
    if (!res) return { ok: false, error: "That took too long. Try again." };

    if (res.error) {
      const detail = await readError(res.error);
      return { ok: false, error: detail ?? res.error.message };
    }
    if (res.data?.error) return { ok: false, error: res.data.error };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "That didn't go through.",
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

/** Sends a fresh 6-digit code to `email`. Safe to call again to resend. */
export function requestSignupCode(email: string): Promise<Outcome> {
  return call("request-signup-code", { email: email.trim().toLowerCase() });
}

/** Checks `code` against what was sent to `email`. */
export function verifySignupCode(email: string, code: string): Promise<Outcome> {
  return call("verify-signup-code", { email: email.trim().toLowerCase(), code: code.trim() });
}
