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
-- lib/tickets.ts keeps its copy for drawing the picker. It is a display cache
-- now, not the authority - and these rows were generated from it, so the two
-- start out identical.

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

-- Seeded from lib/tickets.ts as it stood when this was written. ON CONFLICT
-- DO NOTHING so re-running never overwrites a price edited since.
insert into public.ticket_tiers
  (event_slug, tier_id, name, price_cents, capacity, sold, max_per_order, admits, donation, min_cents, blurb)
values
('wecametoofurr', 'rsvp', 'Free RSVP', 0, 150, 73, 2, 1, false, null, 'Location is sent to you on the day of the event.'),
  ('wecametoofurr', 'donate', 'Donation', 0, 2147483647, 0, 1, 0, true, 100, 'Chip in for sound, lights and the next one. Any amount helps.'),
  ('saviis-21st-color-wave', 'rsvp', 'Free RSVP', 0, 100, 92, 2, 1, false, null, 'Dress code is colour. All of it.'),
  ('saviis-21st-color-wave', 'kit', 'RSVP + Colour Kit', 1200, 60, 21, 4, 1, false, null, 'Paint, chalk and a poncho waiting at the door.'),
  ('wecametooswag', 'rsvp', 'Free RSVP', 0, 200, 9, 4, 1, false, null, null),
  ('sniff-snort-pt-2', 'early', 'Early Bird', 1000, 50, 50, 4, 1, false, null, 'First fifty only.'),
  ('sniff-snort-pt-2', 'ga', 'General Admission', 1500, 150, 61, 6, 1, false, null, null),
  ('sniff-snort-pt-2', 'four', 'Group Of Four', 5000, 25, 4, 2, 4, false, null, 'One code, four heads through the door.'),
  ('wecametoocosplay', 'early', 'Early Bird', 1500, 60, 60, 4, 1, false, null, 'Gone.'),
  ('wecametoocosplay', 'ga', 'General Admission', 2000, 180, 44, 6, 1, false, null, null),
  ('wecametoocosplay', 'vip', 'VIP + Contest Entry', 3500, 40, 11, 4, 1, false, null, 'Early entry and a slot in the costume contest.'),
  ('wecametoohalloween', 'ga', 'General Admission', 2500, 300, 27, 6, 1, false, null, null),
  ('wecametoohalloween', 'vip', 'VIP', 4500, 60, 6, 4, 1, false, null, 'In from noon, private bar, own entrance.'),
  ('wecametoohalloween', 'table', 'Table For Six', 25000, 8, 1, 1, 6, false, null, 'Reserved table, bottle service, six wristbands.')
on conflict (event_slug, tier_id) do nothing;

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
