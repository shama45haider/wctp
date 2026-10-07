/**
 * Puts one event's tickets into Stripe as Products and Prices.
 *
 * Called from /admin/events whenever a tier or the event itself is saved, so
 * a paid ticket exists in Stripe the moment it exists on the site: named
 * "<event> - <tier>", priced from public.ticket_tiers, renamed when the event
 * or tier is renamed, re-priced (new Price, old one archived) when the amount
 * changes, and archived when the tier is removed or made free.
 *
 * Admins only - checked against public.admins with the caller's own JWT.
 * Nothing in the body says what anything costs; only which event to sync.
 *
 *   npx supabase functions deploy sync-ticket-products --use-api --project-ref mkcuiglmsmxcchywruay
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  archiveStaleProducts,
  ensureTierPrice,
  eventTitleFor,
  isMissing0030,
  TIER_COLUMNS,
  type TierRow,
} from "../_shared/stripe-catalog.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return json({ error: "Stripe is not configured." }, 500);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin } = await asCaller.rpc("is_admin");
  if (isAdmin !== true) return json({ error: "Admins only." }, 403);

  let payload: { eventSlug?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const eventSlug = typeof payload.eventSlug === "string" ? payload.eventSlug.trim() : "";
  if (!eventSlug) return json({ error: "Which event?" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data, error } = await admin.from("ticket_tiers").select(TIER_COLUMNS).eq("event_slug", eventSlug);
  if (error) {
    return json({
      error: isMissing0030(error.message)
        ? "Run supabase/APPLY_0030.sql in the Supabase SQL editor first - there is nowhere to keep the Stripe ids yet."
        : `Could not read the tickets: ${error.message}`,
    }, 500);
  }

  const title = await eventTitleFor(admin, eventSlug);
  const keep = new Map<string, string>();
  const tiers: { tierId: string; priceId: string | null; error?: string }[] = [];

  for (const tier of (data ?? []) as TierRow[]) {
    try {
      const ids = await ensureTierPrice(admin, key, tier, title, true);
      tiers.push({ tierId: tier.tier_id, priceId: ids?.priceId ?? null });
      if (ids) keep.set(tier.tier_id, ids.productId);
    } catch (e) {
      tiers.push({ tierId: tier.tier_id, priceId: null, error: e instanceof Error ? e.message : "Stripe failed." });
    }
  }

  // Only when every tier went through: a tier whose sync failed has no
  // product id in `keep` and would otherwise look removed.
  let archived = 0;
  if (tiers.every((t) => !t.error)) {
    archived = await archiveStaleProducts(key, eventSlug, keep).catch(() => 0);
  }

  const failed = tiers.filter((t) => t.error);
  return json({
    ok: failed.length === 0,
    tiers,
    archived,
    ...(failed.length ? { error: failed.map((t) => `${t.tierId}: ${t.error}`).join("; ") } : {}),
  });
});
