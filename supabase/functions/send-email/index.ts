/**
 * Sends one email through Resend, from somewhere the API key can actually
 * live.
 *
 * The obvious version of this - `new Resend(key)` next to the code that
 * wants to send - cannot work in this project, twice over. The site is a
 * static export with no server behind it, so anything imported by a page is
 * compiled into the JavaScript every visitor downloads: the key would be
 * readable in devtools by anyone who opened the site, and whoever read it
 * could send mail as this domain until it was rotated. Resend also refuses
 * browser calls outright, so the leak would buy an attacker more than it
 * would ever buy us.
 *
 * So the key lives here instead, as a secret on a Deno function Supabase
 * runs server-side, and the browser asks this to send rather than sending
 * itself. Set it with:
 *
 *   npx supabase secrets set RESEND_API_KEY=re_your_real_key
 *
 * and deploy with:
 *
 *   npx supabase functions deploy send-email --project-ref mkcuiglmsmxcchywruay
 *
 * ADMINS ONLY, and that is load-bearing rather than tidy. The anon key this
 * site ships is public by design, so "signed in" is a bar anyone can clear
 * by signing up - a function that took a to/subject/html from any caller
 * would be an open relay wearing wecametooparty.com's return address. The
 * caller's own JWT is checked against the admins table here, the same rule
 * is_admin() enforces everywhere else in the schema.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend will only deliver from a domain you have verified. Until
 * wecametooparty.com is verified in the Resend dashboard, onboarding@resend.dev
 * is the sandbox sender, and it only ever delivers to the address that owns
 * the Resend account - which is enough to prove the wiring and nothing more.
 * Set EMAIL_FROM to "WECAMETOOPARTY <events@wecametooparty.com>" once the
 * domain is verified.
 */
const FROM = Deno.env.get("EMAIL_FROM") ?? "onboarding@resend.dev";

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

type Payload = {
  to?: string | string[];
  subject?: string;
  html?: string;
  /** Optional plain-text alternative. Resend builds one if this is absent. */
  text?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    // Said plainly rather than as a 500: the usual reason for this is that
    // the secret was never set, and that is a two-minute fix rather than a
    // bug to go hunting for.
    return json(
      { error: "RESEND_API_KEY is not set on this function. See supabase secrets set." },
      500,
    );
  }

  // The caller's own token, not the service role: this asks Supabase who is
  // holding it, and gets nothing back if the answer is nobody.
  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: "Sign in first." }, 401);

  // Fails closed by construction: an error, or a policy that hides the row,
  // both read as "not an admin".
  const { data: adminRow } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRow) return json({ error: "Admins only." }, 403);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const to = Array.isArray(payload.to) ? payload.to : payload.to ? [payload.to] : [];
  const subject = payload.subject?.trim() ?? "";
  const html = payload.html?.trim() ?? "";

  if (to.length === 0) return json({ error: "No recipient." }, 400);
  if (!subject) return json({ error: "No subject." }, 400);
  if (!html && !payload.text) return json({ error: "No body." }, 400);

  // The same request the Resend SDK's emails.send() makes. Called directly
  // so this function carries no dependency that has to be resolved and
  // pinned inside Deno every time it cold starts.
  const sent = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to,
      subject,
      ...(html ? { html } : {}),
      ...(payload.text ? { text: payload.text } : {}),
    }),
  });

  const result = await sent.json().catch(() => ({}));
  if (!sent.ok) {
    // Resend's own wording, passed through rather than flattened: "domain is
    // not verified" and "invalid api key" need different fixes, and only it
    // knows which one happened.
    return json({ error: result?.message ?? `Resend refused it (${sent.status}).` }, 502);
  }

  return json({ id: result?.id ?? null });
});
