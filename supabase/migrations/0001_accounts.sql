-- Accounts, orders and passes.
--
-- Run this in the Supabase SQL editor (or `supabase db push`).
--
-- Read the policies before changing anything. The site is a static export, so
-- the anon key is compiled into JavaScript that anybody can read. That key is
-- meant to be public, but it means row-level security is the ONLY thing
-- standing between a visitor and this data - there is no server-side check
-- anywhere else in the stack. A table with RLS off is a table the whole
-- internet can read and write.

-- ---------------------------------------------------------------- profiles --

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text        not null default '',
  email       text        not null,
  instagram   text,
  phone       text,
  -- Age check outcome. Only the birth YEAR is kept; see app/verify.
  verified    boolean     not null default false,
  birth_year  int,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile"   on public.profiles for select using  (auth.uid() = id);
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles for update using  (auth.uid() = id);

-- New signups get a profile row automatically, so the client never has to
-- create one and no code path can leave a user without somewhere to write.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ admins --

-- Deliberately its own table rather than a flag on profiles. A guest can edit
-- their own profile row, so an is_admin column there would be a column a guest
-- could set on themselves. This table has no insert or update policy at all,
-- which means nothing holding the anon key can write to it - you add door staff
-- from the Supabase dashboard, which runs as service_role and bypasses RLS.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

create policy "read own admin row" on public.admins for select using (auth.uid() = user_id);

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ------------------------------------------------------------------ orders --

create table if not exists public.orders (
  id              text primary key,           -- WCTP-XXXXXX, generated client side
  user_id         uuid        not null references auth.users on delete cascade,
  event_slug      text        not null,
  event_title     text        not null,
  promo_code      text,
  subtotal_cents  int         not null,
  discount_cents  int         not null default 0,
  fee_cents       int         not null default 0,
  total_cents     int         not null,
  buyer_name      text        not null,
  buyer_email     text        not null,
  buyer_phone     text,
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz
);

create index if not exists orders_user_idx  on public.orders (user_id);
create index if not exists orders_event_idx on public.orders (event_slug);

alter table public.orders enable row level security;

create policy "read own orders"    on public.orders for select using (auth.uid() = user_id or public.is_admin());
create policy "insert own orders"  on public.orders for insert with check (auth.uid() = user_id);
create policy "cancel own orders"  on public.orders for update using (auth.uid() = user_id);

-- ------------------------------------------------------------- order lines --

create table if not exists public.order_lines (
  id         bigint generated always as identity primary key,
  order_id   text not null references public.orders on delete cascade,
  tier_id    text not null,
  tier_name  text not null,
  qty        int  not null,
  unit_cents int  not null,
  admits     int  not null default 1
);

create index if not exists order_lines_order_idx on public.order_lines (order_id);

alter table public.order_lines enable row level security;

create policy "read own order lines" on public.order_lines for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())
  ));

create policy "insert own order lines" on public.order_lines for insert
  with check (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
  ));

-- ------------------------------------------------------------------ passes --

create table if not exists public.passes (
  code        text primary key,               -- WCTP-XXXXXX-TIER
  order_id    text not null references public.orders on delete cascade,
  tier_id     text not null,
  tier_name   text not null,
  admits      int  not null default 1,
  price_cents int  not null,
  -- Set when door staff scan it. Shared across every door, which is the whole
  -- reason this lives in a table instead of one phone's localStorage.
  used_at     timestamptz,
  used_by     uuid references auth.users
);

create index if not exists passes_order_idx on public.passes (order_id);

alter table public.passes enable row level security;

create policy "read own passes" on public.passes for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())
  ));

create policy "insert own passes" on public.passes for insert
  with check (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
  ));

-- Only door staff mark a pass used. A guest holding their own ticket must not
-- be able to clear used_at and walk it back in.
create policy "admin marks passes used" on public.passes for update using (public.is_admin());
