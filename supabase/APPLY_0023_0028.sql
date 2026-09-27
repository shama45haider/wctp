-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Makes paid tickets work:
--   0023  ticket prices in the database, paid orders only via Stripe
--   0028  add-ons (Vampire Punch $10, Rave Spoon $5) and real stock counts
--
-- Safe to run twice. After it runs, set up each event's tickets
-- from /admin/events -> Edit -> Tickets.
-- =============================================================

-- Real money for tickets.
--
-- Until now the checkout was a mock: a read-only card field reading
-- 4242 4242 4242 4242 over the words "no card is charged". Orders were written
-- straight from the browser with whatever total the browser said, which was
-- harmless while nothing moved. It stops being harmless the moment Stripe is
-- connected, because the prices live in the JavaScript bundle and the insert
-- came from the same place - so a $250 table could be bought for $0 by anyone
-- willing to edit a request.
--
-- Two changes fix that, and neither is optional:
--
--   1. Prices move into this table, where the browser cannot reach them. The
--      edge function prices every order from here and tells Stripe the amount.
--   2. The browser may only ever insert a FREE order. Anything with a price is
--      inserted by the Stripe webhook, running as the service role, after
--      Stripe has confirmed the money arrived.
--
-- The site reads its tiers from this table too, so what the picker shows and
-- what Stripe charges come from the same rows.

-- ------------------------------------------------------------- the prices --

create table if not exists public.ticket_tiers (
  event_slug    text    not null,
  tier_id       text    not null,
  name          text    not null,
  price_cents   int     not null,
  capacity      int     not null default 0,
  sold          int     not null default 0,
  max_per_order int     not null default 6,
  admits        int     not null default 1,
  donation      boolean not null default false,
  min_cents     int,
  blurb         text,

  primary key (event_slug, tier_id),
  constraint ticket_tiers_price    check (price_cents >= 0),
  constraint ticket_tiers_capacity check (capacity >= 0 and sold >= 0)
);

alter table public.ticket_tiers enable row level security;

-- Anyone may read a price. They are already printed on the event page; what
-- matters is that nobody but an admin can write one.
drop policy if exists "anyone reads ticket tiers" on public.ticket_tiers;
create policy "anyone reads ticket tiers" on public.ticket_tiers for select
  using (true);

drop policy if exists "admins write ticket tiers" on public.ticket_tiers;
create policy "admins write ticket tiers" on public.ticket_tiers for all
  using (public.is_admin()) with check (public.is_admin());

-- No seed. Every tier is set up per event from /admin/events; the old
-- sample tiers (bundles, tables, VIP) were placeholders and are gone.

-- ------------------------------------------------------- what was actually paid --

alter table public.orders
  add column if not exists paid_at           timestamptz,
  add column if not exists stripe_session_id text;

-- One order per Stripe session, so a webhook delivered twice - which Stripe
-- does, by design, and which is the single most common way a payment
-- integration double-charges or double-issues - cannot create a second order.
create unique index if not exists orders_stripe_session
  on public.orders (stripe_session_id)
  where stripe_session_id is not null;

create index if not exists orders_paid_idx on public.orders (paid_at);

-- ------------------------------------------------------------- the new rule --

-- The old policy let a signed-in guest insert any order at all. Replaced with
-- one that allows only a genuinely free one.
--
-- total_cents = 0 is the whole of it. A paid order arrives through the webhook
-- on the service role key, which bypasses row-level security entirely, so this
-- does not have to make an exception for it - and there is no exception here
-- for a client to find.
-- The live one is "insert own orders", plural - from 0001. Getting this
-- name wrong leaves the permissive policy in place and the rest of this
-- migration achieving nothing at all.
drop policy if exists "insert own orders" on public.orders;
drop policy if exists "insert own order" on public.orders;
drop policy if exists "create own order" on public.orders;
drop policy if exists "create own free order" on public.orders;
create policy "create own free order" on public.orders for insert
  with check (
    auth.uid() = user_id
    and coalesce(total_cents, 0) = 0
    and coalesce(subtotal_cents, 0) = 0
    -- Nothing may claim to have been paid except the webhook.
    and paid_at is null
    and stripe_session_id is null
  );

-- The same rule, one level down.
--
-- "insert own passes" in 0001 checks only that the order belongs to you. That
-- was fine when an order was already just a claim - but once orders are paid
-- for, it means somebody can buy one ticket and then staple another fifty
-- passes to their own settled order. Same for order_lines, which is what the
-- dashboard reads revenue and headcount off.
--
-- Both are now free-orders-only for a client. Every pass on a paid order is
-- written by the webhook on the service role key, which does not consult
-- these policies at all.

drop policy if exists "insert own passes" on public.passes;
create policy "insert own passes" on public.passes for insert
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
      and coalesce(o.total_cents, 0) = 0
      and o.stripe_session_id is null
  ));

drop policy if exists "insert own order lines" on public.order_lines;
create policy "insert own order lines" on public.order_lines for insert
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
      and coalesce(o.total_cents, 0) = 0
      and o.stripe_session_id is null
  ));

/**
 * Has this order been paid for?
 *
 * A free RSVP counts: nothing was owed and nothing is outstanding. This is
 * what the dashboard totals, so a started-but-abandoned checkout never shows
 * up as revenue.
 */
create or replace function public.order_is_settled(o public.orders)
returns boolean
language sql
immutable
as $$
  select o.cancelled_at is null
     and (o.paid_at is not null or coalesce(o.total_cents, 0) = 0);
$$;

-- Add-ons bought with a ticket, and stock that actually counts down.
--
-- An add-on is something extra picked up at the door - a Vampire Punch, a
-- Rave Spoon - bought in the same Stripe checkout as the ticket. It admits
-- nobody and issues no pass: it is an order line flagged `addon`, which the
-- door sees when it scans any pass on that order.
--
-- Prices live here, where no client can write them, for the same reason
-- ticket_tiers does (0023): create-ticket-checkout prices every order from
-- the database and never from the browser.

create table if not exists public.ticket_addons (
  id            text    primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name          text    not null,
  price_cents   int     not null check (price_cents > 0),
  max_per_order int     not null default 10 check (max_per_order > 0),
  active        boolean not null default true,
  sort          int     not null default 0
);

alter table public.ticket_addons enable row level security;

drop policy if exists "anyone reads ticket addons" on public.ticket_addons;
create policy "anyone reads ticket addons" on public.ticket_addons for select
  using (true);

drop policy if exists "admins write ticket addons" on public.ticket_addons;
create policy "admins write ticket addons" on public.ticket_addons for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.ticket_addons (id, name, price_cents, sort) values
  ('vampire-punch', 'Vampire Punch', 1000, 1),
  ('rave-spoon',    'Rave Spoon',     500, 2)
on conflict (id) do nothing;

-- Which lines on an order are add-ons rather than admissions.
alter table public.order_lines
  add column if not exists addon boolean not null default false;

-- Counts a paid sale against a tier, so capacity means something. Called by
-- the edge functions on the service role only.
create or replace function public.ticket_count_sale(p_event text, p_tier text, p_qty int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ticket_tiers
     set sold = sold + greatest(p_qty, 0)
   where event_slug = p_event and tier_id = p_tier;
$$;

revoke all on function public.ticket_count_sale(text, text, int) from public, anon, authenticated;
grant execute on function public.ticket_count_sale(text, text, int) to service_role;
