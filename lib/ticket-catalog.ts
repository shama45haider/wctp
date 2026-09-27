"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getSupabase } from "./supabase";
import {
  setTicketCatalog,
  subscribeTicketCatalog,
  ticketCatalogVersion,
  type Addon,
  type Tier,
} from "./tickets";

/**
 * Reads ticket tiers and add-ons out of the database into lib/tickets.ts.
 *
 * Loaded once per page load and shared: every component that prices or lists
 * tickets calls useTicketCatalog(), which starts the read if nobody has and
 * re-renders the caller when it lands. The server snapshot is 0, so the static
 * HTML and the first client render agree (nothing on sale here yet), and the
 * real tiers appear a moment later.
 */

type Outcome = { ok: boolean; error?: string };

const TIMEOUT_MS = 8000;

type TierRow = {
  event_slug: string;
  tier_id: string;
  name: string;
  price_cents: number;
  capacity: number;
  sold: number;
  max_per_order: number;
  admits: number | null;
  donation: boolean | null;
  min_cents: number | null;
  blurb: string | null;
};

type AddonRow = {
  id: string;
  name: string;
  price_cents: number;
  max_per_order: number;
  active: boolean;
};

export const NEEDS_0023 =
  "This project has not run migrations 0023 and 0028 yet, so there is nowhere to keep ticket prices. Paste supabase/APPLY_0023_0028.sql into the Supabase SQL editor.";

const isMissing = (m: string) =>
  /ticket_tiers|ticket_addons/i.test(m) && /does not exist|could not find|schema cache/i.test(m);

function client() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

function capped<T>(work: PromiseLike<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

const toTier = (r: TierRow): Tier => ({
  id: r.tier_id,
  name: r.name,
  priceCents: r.price_cents,
  capacity: r.capacity,
  sold: r.sold,
  maxPerOrder: r.max_per_order,
  admits: r.admits ?? 1,
  donation: r.donation || undefined,
  minCents: r.min_cents ?? undefined,
  blurb: r.blurb ?? undefined,
});

let loading: Promise<void> | null = null;
let loaded = false;
let loadError: string | null = null;

/** Reads (or re-reads) the catalog. Never throws; an error leaves the old one. */
export function reloadTicketCatalog(): Promise<void> {
  loading = (async () => {
    const supabase = client();
    if (!supabase) {
      loaded = true;
      setTicketCatalog({}, []);
      return;
    }
    const [tiers, addons] = await Promise.all([
      capped(
        supabase
          .from("ticket_tiers")
          .select(
            "event_slug,tier_id,name,price_cents,capacity,sold,max_per_order,admits,donation,min_cents,blurb",
          )
          .order("price_cents", { ascending: true }),
      ),
      capped(
        supabase
          .from("ticket_addons")
          .select("id,name,price_cents,max_per_order,active")
          .eq("active", true)
          .order("sort", { ascending: true }),
      ),
    ]);

    const byEvent: Record<string, Tier[]> = {};
    if (tiers && !tiers.error) {
      for (const row of (tiers.data ?? []) as TierRow[]) {
        (byEvent[row.event_slug] ??= []).push(toTier(row));
      }
      loadError = null;
    } else {
      loadError = tiers?.error?.message ?? "The database did not answer.";
    }
    const extras: Addon[] =
      addons && !addons.error
        ? ((addons.data ?? []) as AddonRow[]).map((a) => ({
            id: a.id,
            name: a.name,
            priceCents: a.price_cents,
            maxPerOrder: a.max_per_order,
          }))
        : [];

    loaded = true;
    setTicketCatalog(byEvent, extras);
  })();
  return loading;
}

/**
 * Subscribes the caller to the catalog. Returns whether it has loaded, so a
 * picker can say "loading" instead of "not on sale" for the first moment.
 */
export function useTicketCatalog(): { loaded: boolean; error: string | null } {
  const version = useSyncExternalStore(subscribeTicketCatalog, ticketCatalogVersion, () => 0);
  useEffect(() => {
    if (!loading) void reloadTicketCatalog();
  }, []);
  return { loaded: version > 0 && loaded, error: loadError };
}

/* ------------------------------------------------------------ admin edits -- */

export type TierDraft = {
  tierId: string;
  name: string;
  priceCents: number;
  capacity: number;
  maxPerOrder: number;
  blurb?: string;
};

/** Every tier for one event, sold counts included. For the admin editor. */
export async function listTiersFor(slug: string): Promise<{ tiers: Tier[]; error?: string }> {
  const supabase = client();
  if (!supabase) return { tiers: [], error: "Not connected." };
  const res = await capped(
    supabase
      .from("ticket_tiers")
      .select(
        "event_slug,tier_id,name,price_cents,capacity,sold,max_per_order,admits,donation,min_cents,blurb",
      )
      .eq("event_slug", slug)
      .order("price_cents", { ascending: true }),
  );
  if (!res) return { tiers: [], error: "The database did not answer." };
  if (res.error) {
    return { tiers: [], error: isMissing(res.error.message) ? NEEDS_0023 : res.error.message };
  }
  return { tiers: ((res.data ?? []) as TierRow[]).map(toTier) };
}

/** Creates or updates one tier. `sold` is never written from here. */
export async function saveTier(slug: string, t: TierDraft): Promise<Outcome> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Not connected." };
  const res = await capped(
    supabase
      .from("ticket_tiers")
      .upsert(
        {
          event_slug: slug,
          tier_id: t.tierId,
          name: t.name.trim(),
          price_cents: t.priceCents,
          capacity: t.capacity,
          max_per_order: t.maxPerOrder,
          admits: 1,
          blurb: t.blurb?.trim() || null,
        },
        { onConflict: "event_slug,tier_id" },
      )
      .select("tier_id"),
  );
  if (!res) return { ok: false, error: "The database did not answer." };
  if (res.error) {
    return { ok: false, error: isMissing(res.error.message) ? NEEDS_0023 : res.error.message };
  }
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing saved - this account is not an admin." };
  }
  void reloadTicketCatalog();
  return { ok: true };
}

export async function deleteTier(slug: string, tierId: string): Promise<Outcome> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Not connected." };
  const res = await capped(
    supabase
      .from("ticket_tiers")
      .delete()
      .eq("event_slug", slug)
      .eq("tier_id", tierId)
      .select("tier_id"),
  );
  if (!res) return { ok: false, error: "The database did not answer." };
  if (res.error) return { ok: false, error: res.error.message };
  if ((res.data ?? []).length === 0) {
    return { ok: false, error: "Nothing removed - this account is not an admin." };
  }
  void reloadTicketCatalog();
  return { ok: true };
}
