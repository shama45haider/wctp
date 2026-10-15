-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- The four migrations the live database is missing, checked on
-- 2026-10-15, and nothing else:
--   0026  team sections (adding crews on /team)
--   0027  event removals (deleting a date from the home page)
--   0029  event addresses and ticket invoices
--   0030  Stripe product ids on ticket tiers
--
-- No storage policies, no function changes. Every statement is
-- safe to run twice. The last statement prints one row saying
-- whether each one landed.
-- =============================================================


-- ---------- 0026_team_sections.sql ----------

-- Team categories an admin can add from the roster page itself.
--
-- The six sections on /team (CEOs, DJs, Artists, ...) are fixed in
-- lib/artists.ts, so a new kind of crew meant editing source and redeploying.
-- This table holds the extra ones, drawn after the bundled six in `sort`
-- order. team_members.role is already free text, so a card files itself under
-- a new section just by naming its id.

create table if not exists public.team_sections (
  -- The slug a card's role points at and the page anchors on (#<id>s).
  id          text        primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  heading     text        not null,
  label       text        not null,
  blurb       text,
  -- A CSS hex colour for the section's accent.
  accent      text        not null default '#ff5fa8' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  sort        int         not null default 0,
  created_by  uuid        references auth.users default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.team_sections enable row level security;

drop policy if exists "anyone reads team sections" on public.team_sections;
create policy "anyone reads team sections" on public.team_sections for select
  using (true);

drop policy if exists "admins write team sections" on public.team_sections;
create policy "admins write team sections" on public.team_sections for insert
  with check (public.is_admin());
drop policy if exists "admins update team sections" on public.team_sections;
create policy "admins update team sections" on public.team_sections for update
  using (public.is_admin());
drop policy if exists "admins delete team sections" on public.team_sections;
create policy "admins delete team sections" on public.team_sections for delete
  using (public.is_admin());


-- ---------- 0027_event_removals.sql ----------

-- Events an admin deleted from the home page.
--
-- Deleting the row in public.events is not enough on its own: most dates are
-- also compiled into the bundle from lib/events.ts, and the site lays the
-- database over that list rather than replacing it, so a bundled date would
-- come straight back. A slug listed here is dropped from every list on the
-- site, bundled or not. Saving the date again from /admin/events clears it.
--
-- Readable by anyone, because a guest's browser is the one that has to leave
-- the date out. Only an admin writes.

create table if not exists public.event_removals (
  slug        text        primary key,
  removed_by  uuid        references auth.users default auth.uid(),
  removed_at  timestamptz not null default now()
);

alter table public.event_removals enable row level security;

drop policy if exists "anyone reads event removals" on public.event_removals;
create policy "anyone reads event removals" on public.event_removals for select
  using (true);

drop policy if exists "admins write event removals" on public.event_removals;
create policy "admins write event removals" on public.event_removals for insert
  with check (public.is_admin());
drop policy if exists "admins update event removals" on public.event_removals;
create policy "admins update event removals" on public.event_removals for update
  using (public.is_admin());
drop policy if exists "admins delete event removals" on public.event_removals;
create policy "admins delete event removals" on public.event_removals for delete
  using (public.is_admin());


-- ---------- 0029_event_address.sql ----------

-- The address for a date, and the email that delivers it.
--
-- The site promises "address by email": nobody sees where a night is until
-- the day before, when every ticket holder is sent it. event_details holds
-- that address. Only an admin can read or write it - there is no policy for
-- anyone else, so the anon key and a guest's session get nothing back, not
-- even that a row exists. The send-event-addresses edge function reads it on
-- the service role.
--
-- It also carries the date's title, day and door time, because the dates
-- built into the site (lib/events.ts) have no row in public.events, and the
-- function that sends the email cannot read the site's code. The dashboard
-- copies them in whenever the address is saved.

create table if not exists public.event_details (
  event_slug  text        primary key,
  title       text        not null,
  event_date  date        not null,
  -- As printed on the flyer: "10:00 PM", "10PM".
  doors       text        not null,
  address     text        not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.event_details enable row level security;

drop policy if exists "admins read event details" on public.event_details;
create policy "admins read event details" on public.event_details for select
  using (public.is_admin());

drop policy if exists "admins add event details" on public.event_details;
create policy "admins add event details" on public.event_details for insert
  with check (public.is_admin());

drop policy if exists "admins edit event details" on public.event_details;
create policy "admins edit event details" on public.event_details for update
  using (public.is_admin());

drop policy if exists "admins delete event details" on public.event_details;
create policy "admins delete event details" on public.event_details for delete
  using (public.is_admin());

-- When this order's holder was emailed the address. Null until then, so the
-- hourly send picks up a ticket bought after the first round went out.
alter table public.orders
  add column if not exists address_sent_at timestamptz;

-- The Stripe invoice for a paid ticket order, the way store_orders keeps one
-- for a prize (0025).
alter table public.orders
  add column if not exists invoice_number text;
alter table public.orders
  add column if not exists invoice_url text;


-- ---------- 0030_stripe_ticket_products.sql ----------

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


-- ---------- did it land? ----------

select
  to_regclass('public.team_sections')  is not null as team_sections_0026,
  to_regclass('public.event_removals') is not null as event_removals_0027,
  to_regclass('public.event_details')  is not null as event_details_0029,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ticket_tiers' and column_name = 'stripe_product_id'
  ) as stripe_columns_0030;
