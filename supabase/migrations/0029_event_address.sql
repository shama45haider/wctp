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
