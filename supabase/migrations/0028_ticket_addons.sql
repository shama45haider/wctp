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
