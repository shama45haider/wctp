/**
 * Sends a one-time code to an email address that has not signed up yet, and
 * writes it to public.signup_codes so verify-signup-code and, in turn,
 * handle_new_user() can check for it later. See the migration
 * (0013_verify_email_before_signup.sql) for why this exists: proving an
 * address before an account for it can be created, rather than after.
 *
 * Callable by anyone signed out, which is the whole point - a guest has no
 * session yet at the point they are asking for a code. That also makes this
 * the one function in this project an attacker could hit for free, so the
 * two things worth defending are the same two things any "send me a code"
 * endpoint has to: not becoming a way to spam arbitrary strangers, and not
 * telling a caller anything about who already has an account. Both are
 * handled below; nothing else here needs auth because there is nothing
 * sensitive yet to protect - the row this writes cannot itself create
 * anything without a code being typed back correctly.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = Deno.env.get("EMAIL_FROM") ?? "onboarding@resend.dev";

/** How long a fresh code is good for before it has to be re-sent. */
const CODE_TTL_MS = 15 * 60 * 1000;
/** Do not send a second code to the same address faster than this. */
const COOLDOWN_MS = 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js sends apikey and x-client-info on every invoke; a preflight
  // that doesn't allow them makes the browser drop the call entirely.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function randomCode(): string {
  // 6 digits, drawn from a real source of randomness rather than Math.random
  // - it is short enough that the only thing standing between a guesser and
  // the right answer is how few times they are allowed to be wrong, which is
  // verify-signup-code's job, not this one's.
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

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

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) return json({ error: "That email doesn't look right." }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!url || !serviceKey) return json({ error: "Not configured." }, 500);
  if (!resendKey) {
    return json({ error: "RESEND_API_KEY is not set on this function." }, 500);
  }

  // The service role key, not the anon key: this table has no policy that
  // grants either role anything, on purpose - see the migration.
  const supabase = createClient(url, serviceKey);

  const existing = await supabase
    .from("signup_codes")
    .select("created_at")
    .eq("email", email)
    .maybeSingle();

  if (existing.data && Date.now() - Date.parse(existing.data.created_at) < COOLDOWN_MS) {
    return json({ error: "Give it a minute before asking for another code." }, 429);
  }

  const code = randomCode();
  const codeHash = await hash(code);
  const now = new Date();

  const write = await supabase.from("signup_codes").upsert({
    email,
    code_hash: codeHash,
    attempts: 0,
    verified_at: null,
    expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    created_at: now.toISOString(),
  });
  if (write.error) return json({ error: write.error.message }, 500);

  const sent = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: `${code} is your WECAMETOOPARTY code`,
      html: `<p style="font:16px system-ui">Your code is</p><p style="font:32px/1 monospace;letter-spacing:0.1em"><strong>${code}</strong></p><p style="font:14px system-ui;color:#666">Expires in 15 minutes. If you didn't ask for this, ignore it.</p>`,
      text: `Your code is ${code}. It expires in 15 minutes. If you didn't ask for this, ignore it.`,
    }),
  });

  if (!sent.ok) {
    const detail = await sent.json().catch(() => ({}));
    // The row stays regardless: a bad send is worth surfacing, but should
    // not force a caller to also lose the cooldown window they just waited
    // out, if the actual mail attempt is what failed.
    return json({ error: detail?.message ?? `Resend refused it (${sent.status}).` }, 502);
  }

  return json({ ok: true });
});
