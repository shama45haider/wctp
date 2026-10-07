-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Migration 0030: every paid ticket becomes a real Product and
-- Price in Stripe, made automatically when a ticket is saved in
-- /admin/events. These columns are where the Stripe ids are kept.
--
-- Safe to run twice. Until it runs, tickets still sell - Stripe
-- just gets no product for them.
-- =============================================================

-- Every paid ticket is a real Product in Stripe.
--
-- Until now create-ticket-checkout described each ticket to Stripe inline
-- (price_data), which charges correctly but leaves nothing behind in the
-- Stripe dashboard: no product per night, no price to report sales against.
-- Saving a paid tier in /admin/events now creates its Product and Price in
-- Stripe through the sync-ticket-products edge function, and the checkout
-- charges that Price.
--
-- Stripe prices cannot be edited, so a changed amount makes a new Price and
-- archives the old one. stripe_price_cents records which amount the stored
-- price is for: when it no longer matches price_cents, the checkout knows the
-- stored price is stale and makes a fresh one before charging. price_cents is
-- still the only amount anything is charged from.
--
-- Written only by the edge functions on the service role key. Admins can
-- already write this table (0023); nothing else can.

alter table public.ticket_tiers
  add column if not exists stripe_product_id  text,
  add column if not exists stripe_price_id    text,
  add column if not exists stripe_price_cents int;
