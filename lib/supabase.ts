import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client, or null when the site has not been given credentials.
 *
 * Null is a supported state, not an error. The site is a static export that
 * deploys from a fork or a fresh clone with no secrets configured, and it
 * should still build and still run - `useAccount` falls back to localStorage
 * when this is null. So every caller has to handle null rather than assume a
 * client exists.
 *
 * Both values are NEXT_PUBLIC_, which means they are inlined into the bundle at
 * build time and are readable by anyone who opens devtools. That is correct for
 * the anon key, which is a public identifier by design - but it is only safe
 * because row-level security is switched on for every table. See
 * supabase/migrations/0001_accounts.sql.
 *
 * The service_role key must never appear here, in any NEXT_PUBLIC_ variable, or
 * anywhere else in this repo. It bypasses RLS entirely, and everything in a
 * static build reaches the browser.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  // Created once and reused: a second client would keep its own auth state and
  // the two would disagree about who is signed in.
  client ??= createClient(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The session arrives as a code in the URL after a magic link. There is
      // no server to exchange it, so the browser does it with PKCE.
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return client;
}
