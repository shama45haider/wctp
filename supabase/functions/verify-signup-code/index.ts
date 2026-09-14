/**
 * Checks a code against what request-signup-code sent, and marks the address
 * proven if it matches. handle_new_user() is what actually acts on
 * `verified_at` - this only ever sets it, never creates anything itself.
 *
 * Wrong guesses are counted rather than just rejected: a six-digit code has
 * a million possibilities, which a hash on this row does nothing to protect
 * against - the only real defence is capping how many times a caller may be
 * wrong before the code is dead and they have to ask for a fresh one.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

/** Wrong guesses allowed before the code is burned outright. */
const MAX_ATTEMPTS = 5;
/** How long a verified email stays usable for the signup that follows it. */
const VERIFIED_TTL_MS = 30 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function hash(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const code = body.code?.trim() ?? "";
  if (!email || !/^\d{6}$/.test(code)) {
    return json({ error: "Enter the 6-digit code." }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Not configured." }, 500);
  const supabase = createClient(url, serviceKey);

  const row = await supabase
    .from("signup_codes")
    .select("code_hash, attempts, expires_at, verified_at")
    .eq("email", email)
    .maybeSingle();

  if (row.error) return json({ error: row.error.message }, 500);
  if (!row.data) {
    return json({ error: "No code on file for that address. Ask for one first." }, 404);
  }
  if (row.data.verified_at) {
    // Not an error: a guest who double-taps Verify, or goes back and forward
    // in the wizard, should not be told their already-good code broke.
    return json({ ok: true });
  }
  if (Date.parse(row.data.expires_at) < Date.now()) {
    return json({ error: "That code expired. Ask for a new one." }, 410);
  }
  if (row.data.attempts >= MAX_ATTEMPTS) {
    return json({ error: "Too many wrong tries. Ask for a new code." }, 429);
  }

  const guessHash = await hash(code);
  if (guessHash !== row.data.code_hash) {
    const left = MAX_ATTEMPTS - (row.data.attempts + 1);
    await supabase
      .from("signup_codes")
      .update({ attempts: row.data.attempts + 1 })
      .eq("email", email);
    return json(
      {
        error:
          left > 0
            ? `That's not the code. ${left} ${left === 1 ? "try" : "tries"} left.`
            : "Too many wrong tries. Ask for a new code.",
      },
      401,
    );
  }

  const write = await supabase
    .from("signup_codes")
    .update({
      verified_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + VERIFIED_TTL_MS).toISOString(),
    })
    .eq("email", email);
  if (write.error) return json({ error: write.error.message }, 500);

  return json({ ok: true });
});
