"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * Who is asking, for the pages that need to know.
 *
 * Email only, and no password anywhere in the stack. The guest asks for a
 * link, Supabase mails it, and the browser exchanges the code it comes back
 * with. A password field would need somewhere to check the password, and this
 * site is a static export - there is nowhere.
 *
 * Everything here assumes the database might not answer. The anon key is
 * inlined at build time, so a fork, a rotated key or a paused project all
 * present the same way: calls that reject, or worse, calls that never settle
 * at all. So every path is capped by a timer and every rejection lands in
 * `error` instead of in a render - a hook that throws takes the page down with
 * it, and a hook that hangs leaves a spinner up forever.
 */

export type AuthUser = { id: string; email: string } | null;

type Outcome = { ok: boolean; error?: string };

const NOT_CONNECTED =
  "Accounts are not connected. This build has no working Supabase credentials.";
const UNREACHABLE = "Could not reach the account service.";

/** How long any one call gets before the page stops waiting on it. */
const TIMEOUT_MS = 8000;

/**
 * `work`, or `fallback` if it has not answered in time.
 *
 * A request to a host that is not there does not fail quickly - it sits on the
 * browser's own timeout, minutes away. Nothing on screen should wait that long
 * to be told something went wrong.
 */
function withTimeout<T>(work: PromiseLike<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(work), capped]).finally(() =>
    clearTimeout(timer),
  );
}

/** Runs an auth call, turning a rejection, a timeout or an API error into text. */
async function attempt(
  work: PromiseLike<{ error: { message: string } | null }>,
): Promise<Outcome> {
  try {
    const { error } = await withTimeout(work, {
      error: { message: UNREACHABLE },
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : UNREACHABLE,
    };
  }
}

/**
 * Membership of the admins table, and nothing else.
 *
 * Fails closed by construction: an error, a timeout, or a policy that hides
 * the row all read as "not an admin". This decides what goes on the screen and
 * nothing more - the database enforces the same rule again through is_admin()
 * in supabase/migrations/0001_accounts.sql - but it is still the one answer
 * that must never be invented.
 */
async function readsAsAdmin(supabase: SupabaseClient, id: string) {
  try {
    const { data, error } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", id)
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

/**
 * getSupabase(), which can throw on its first call - createClient parses the
 * project URL, and a mangled one in the environment would land the error
 * inside a render instead of on the screen.
 */
function safeClient() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

/**
 * Where the emailed link comes back to.
 *
 * The page it was requested from, so signing in at the door screen returns to
 * the door screen. Whatever this resolves to has to be on the project's
 * redirect allow list in the Supabase dashboard, or the link lands on the site
 * root carrying an error instead of a session.
 */
function returnTo() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}

export function useSupabaseAuth() {
  // Seeded from a build-time constant rather than set from the effect below,
  // so a build with no credentials renders its "not connected" state on the
  // first pass instead of a loading state it would never leave.
  const [sessionKnown, setSessionKnown] = useState(!isSupabaseConfigured);
  const [user, setUser] = useState<AuthUser>(null);
  const [error, setError] = useState<string | null>(
    isSupabaseConfigured ? null : NOT_CONNECTED,
  );
  // Carries the id it was decided for, so an answer about the previous user
  // can never be read as an answer about this one.
  const [adminFor, setAdminFor] = useState<{
    id: string;
    admin: boolean;
  } | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const supabase = safeClient();
    let live = true;

    // The backstop that guarantees `ready` flips.
    //
    // With a client, INITIAL_SESSION lands as soon as storage has been read
    // and cancels this. But a client whose token refresh is waiting on a host
    // that never answers emits nothing at all, and the page cannot stay on a
    // spinner for as long as the browser takes to give up. With no client
    // there is nothing to wait for, so it settles on the next tick.
    const settle = setTimeout(
      () => {
        if (!live) return;
        setSessionKnown(true);
        setError(supabase ? UNREACHABLE : NOT_CONNECTED);
      },
      supabase ? TIMEOUT_MS : 0,
    );

    const apply = (session: Session | null) => {
      if (!live) return;
      clearTimeout(settle);
      const next: AuthUser = session?.user
        ? { id: session.user.id, email: session.user.email ?? "" }
        : null;
      // Compared field by field rather than swapped wholesale: a token refresh
      // hands back a new object for the same person every hour, and a new
      // object re-runs every effect downstream that keys off the user.
      setUser((prev) =>
        prev?.id === next?.id && prev?.email === next?.email ? prev : next,
      );
      setSessionKnown(true);
      setError(null);
    };

    // Deliberately not an async callback. Awaiting inside this handler can
    // deadlock against the client's own token refresh, so the admin lookup
    // happens in the effect below, outside the callback entirely.
    const sub = supabase?.auth.onAuthStateChange((_event, session) =>
      apply(session),
    );

    return () => {
      live = false;
      clearTimeout(settle);
      sub?.data.subscription.unsubscribe();
    };
  }, []);

  const id = user?.id;
  useEffect(() => {
    if (!id) return;
    const supabase = safeClient();
    if (!supabase) return;

    let live = true;
    void (async () => {
      const admin = await withTimeout(readsAsAdmin(supabase, id), false);
      if (live && alive.current) setAdminFor({ id, admin });
    })();

    return () => {
      live = false;
    };
  }, [id]);

  const signInWithEmail = useCallback(
    async (email: string): Promise<Outcome> => {
      const supabase = safeClient();
      if (!supabase) return { ok: false, error: NOT_CONNECTED };

      const out = await attempt(
        supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: returnTo() },
        }),
      );
      if (alive.current) setError(out.error ?? null);
      return out;
    },
    [],
  );

  /** For guests who would rather type the six digits than follow the link. */
  const verifyOtp = useCallback(
    async (email: string, token: string): Promise<Outcome> => {
      const supabase = safeClient();
      if (!supabase) return { ok: false, error: NOT_CONNECTED };

      const out = await attempt(
        supabase.auth.verifyOtp({
          email: email.trim(),
          token: token.trim(),
          type: "email",
        }),
      );
      if (alive.current) setError(out.error ?? null);
      return out;
    },
    [],
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<Outcome> => {
      const supabase = safeClient();
      if (!supabase) return { ok: false, error: NOT_CONNECTED };

      const out = await attempt(
        supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        }),
      );
      if (alive.current) setError(out.error ?? null);
      return out;
    },
    [],
  );

  /**
   * First-time password for an address that has none.
   *
   * An account created by an emailed code has no password until one is set, so
   * this exists to give it one. Whether the new account can be used straight
   * away is the project's decision, not this page's: with email confirmation
   * switched on Supabase issues no session until the address is confirmed, and
   * the caller has to say so rather than report a success nobody can act on.
   */
  const signUpWithPassword = useCallback(
    async (email: string, password: string): Promise<Outcome> => {
      const supabase = safeClient();
      if (!supabase) return { ok: false, error: NOT_CONNECTED };

      const out = await attempt(
        supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: returnTo() },
        }),
      );
      if (alive.current) setError(out.error ?? null);
      return out;
    },
    [],
  );

  const signOut = useCallback(async () => {
    const supabase = safeClient();
    if (!supabase) return;

    // Local scope. The default signs out every device at once, and a phone
    // locking itself at the door should not end the session on the laptop
    // running the dashboard.
    const out = await attempt(supabase.auth.signOut({ scope: "local" }));
    if (!alive.current) return;
    setError(out.error ?? null);
    // SIGNED_OUT normally clears these. Doing it here as well means a call
    // that failed still leaves the screen locked rather than showing a
    // session nothing will accept.
    setUser(null);
    setAdminFor(null);
  }, []);

  const isAdmin = Boolean(
    user && adminFor && adminFor.id === user.id && adminFor.admin,
  );

  return {
    /**
     * True once there is an answer to give - including the answer that there
     * is no database. Held back until the admin check has landed too, so the
     * dashboard is never drawn twice, once as refused and once as allowed.
     */
    ready:
      sessionKnown &&
      (user === null || (adminFor !== null && adminFor.id === user.id)),
    user,
    isAdmin,
    error,
    signInWithEmail,
    verifyOtp,
    signInWithPassword,
    signUpWithPassword,
    signOut,
  };
}
