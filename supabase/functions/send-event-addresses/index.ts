/**
 * Emails each date's address to everyone holding a ticket for it.
 *
 * The site sells a night without saying where it is; the address goes out by
 * email the day before. This is that email. It is called two ways:
 *
 *   - Every hour by .github/workflows/send-addresses.yml, with the
 *     x-cron-secret header. It sends for every date whose window is open:
 *     from noon New York time the day before, until twelve hours after the
 *     doors. Hourly rather than once, so a ticket bought after the first
 *     round still gets the address within the hour.
 *   - By an admin from the dashboard ("Email it now"), signed in, with
 *     { slug }. That sends for one date straight away, window or not.
 *
 * Either way an order is emailed once: address_sent_at is stamped when its
 * email is accepted, and only orders without one are picked up.
 *
 * Deployed with --no-verify-jwt, because the scheduled call carries no user;
 * this function checks the secret or the admin itself.
 *
 *   npx supabase secrets set ADDRESS_CRON_SECRET=<long random string>
 *   npx supabase functions deploy send-event-addresses --no-verify-jwt --use-api
 *
 * The same secret goes in the repo's Actions secrets as ADDRESS_CRON_SECRET.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_BATCH = "https://api.resend.com/emails/batch";
/** Resend takes at most a hundred messages per batch call. */
const BATCH = 100;
const FROM = Deno.env.get("EMAIL_FROM") ?? "onboarding@resend.dev";
const SITE = "https://wecametooparty.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type Detail = {
  event_slug: string;
  title: string;
  event_date: string;
  doors: string;
  address: string;
};

/* ------------------------------------------------------------------ time -- */

/** "10:00 PM", "10PM", "9:30pm" to [22, 0]; null if it can't be read. */
function parseClock(time: string): [number, number] | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(time.trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") hour += 12;
  return [hour, Number(m[2] ?? 0)];
}

/** A New York wall-clock date and time as an instant - lib/tickets.ts doorsAt(). */
function nyInstant(date: string, clock: [number, number]): number | null {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!ymd) return null;
  const wall = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), clock[0], clock[1]);
  const read = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(wall));
  const part = (type: string) => Number(read.find((p) => p.type === type)?.value);
  const shown = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return wall + (wall - shown);
}

const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Whether the address should be going out right now. */
function windowOpen(d: Detail, now: number): boolean {
  const opens = nyInstant(dayBefore(d.event_date), [12, 0]);
  const doors = nyInstant(d.event_date, parseClock(d.doors) ?? [21, 0]);
  if (opens === null || doors === null) return false;
  return now >= opens && now <= doors + 12 * 3_600_000;
}

/* ----------------------------------------------------------------- email -- */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function longDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function message(d: Detail, name: string) {
  const when = `${longDate(d.event_date)}, doors ${d.doors}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`;
  const first = name.trim().split(/\s+/)[0] || "you";
  const subject = `The address for ${d.title}`;
  const text = [
    `Hey ${first},`,
    "",
    `You're on the list for ${d.title} - ${when}.`,
    "",
    "Here's where:",
    d.address,
    "",
    `Map: ${mapUrl}`,
    `Your ticket QR is on your account: ${SITE}/account`,
    "",
    "Keep the address to yourself. See you there.",
    "WECAMETOOPARTY",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#050505;color:#f2f4f7;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;color:#e8213f">YOU'RE ON THE LIST</p>
  <h1 style="margin:0 0 6px;font-size:30px;line-height:1.05;text-transform:uppercase">${esc(d.title)}</h1>
  <p style="margin:0 0 24px;color:#c9cdd4;font-size:15px">${esc(when)}</p>
  <p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;color:#7a8089">THE ADDRESS</p>
  <p style="margin:0 0 14px;font-size:20px;line-height:1.35;white-space:pre-line">${esc(d.address)}</p>
  <p style="margin:0 0 28px"><a href="${mapUrl}" style="color:#e8213f">Open in Maps</a></p>
  <p style="margin:0 0 24px"><a href="${SITE}/account" style="display:inline-block;background:#c8102e;color:#f2f4f7;text-decoration:none;padding:12px 18px;font-weight:bold;letter-spacing:.08em">YOUR TICKET QR</a></p>
  <p style="margin:0;color:#7a8089;font-size:13px;line-height:1.5">Hey ${esc(first)} - keep the address to yourself. See you there.<br>WECAMETOOPARTY</p>
</div></body></html>`;
  return { subject, text, html };
}

/* ------------------------------------------------------------------ main -- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY is not set on this function." }, 500);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  let body: { slug?: string } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is the scheduled call.
  }

  // Who is asking. The schedule proves itself with the shared secret; anyone
  // else has to be a signed-in admin, and then only for one date.
  const cronSecret = Deno.env.get("ADDRESS_CRON_SECRET");
  const fromCron = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;
  let only: string | null = null;
  if (!fromCron) {
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData } = await asUser.auth.getUser();
    if (!userData?.user) return json({ error: "Sign in first." }, 401);
    const { data: adminRow } = await asUser
      .from("admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!adminRow) return json({ error: "Admins only." }, 403);
    only = body.slug?.trim() || null;
    if (!only) return json({ error: "Which date?" }, 400);
  }

  let query = admin.from("event_details").select("event_slug,title,event_date,doors,address").neq("address", "");
  if (only) query = query.eq("event_slug", only);
  const { data: details, error: detailError } = await query;
  if (detailError) {
    // Before 0029 is applied there is nothing to send. Say so quietly to the
    // schedule, rather than failing - and emailing the repo's owner - hourly.
    const missing = /event_details/i.test(detailError.message) &&
      /does not exist|could not find|schema cache/i.test(detailError.message);
    if (missing && fromCron) return json({ ok: true, dates: [], waiting: "Run supabase/APPLY_0029.sql." });
    return json({ error: missing ? "Run supabase/APPLY_0029.sql in the Supabase SQL editor first." : detailError.message }, 500);
  }

  const now = Date.now();
  const due = ((details ?? []) as Detail[]).filter((d) => only || windowOpen(d, now));
  if (only && due.length === 0) return json({ error: "That date has no address saved yet." }, 400);

  const report: { slug: string; sent: number; failed?: string }[] = [];
  for (const d of due) {
    const { data: orders, error: orderError } = await admin
      .from("orders")
      .select("id,buyer_name,buyer_email")
      .eq("event_slug", d.event_slug)
      .not("paid_at", "is", null)
      .is("cancelled_at", null)
      .is("address_sent_at", null);
    if (orderError) {
      report.push({ slug: d.event_slug, sent: 0, failed: orderError.message });
      continue;
    }

    // One email per address, however many orders it placed.
    const byEmail = new Map<string, { name: string; ids: string[] }>();
    for (const o of orders ?? []) {
      const email = String(o.buyer_email ?? "").trim().toLowerCase();
      if (!email) continue;
      const seen = byEmail.get(email);
      if (seen) seen.ids.push(o.id);
      else byEmail.set(email, { name: String(o.buyer_name ?? ""), ids: [o.id] });
    }

    const people = [...byEmail.entries()];
    let sent = 0;
    for (let i = 0; i < people.length; i += BATCH) {
      const chunk = people.slice(i, i + BATCH);
      const res = await fetch(RESEND_BATCH, {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map(([email, p]) => ({ from: FROM, to: [email], ...message(d, p.name) })),
        ),
      });
      if (!res.ok) {
        const why = await res.text().catch(() => "");
        report.push({ slug: d.event_slug, sent, failed: `Resend ${res.status}: ${why.slice(0, 200)}` });
        break;
      }
      const ids = chunk.flatMap(([, p]) => p.ids);
      await admin.from("orders").update({ address_sent_at: new Date().toISOString() }).in("id", ids);
      sent += chunk.length;
    }
    if (!report.some((r) => r.slug === d.event_slug)) report.push({ slug: d.event_slug, sent });
  }

  return json({ ok: true, dates: report });
});
