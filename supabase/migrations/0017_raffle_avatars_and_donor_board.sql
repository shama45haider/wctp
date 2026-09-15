-- Profile pictures on the raffle list, and a donor board fed by Stripe.
--
-- raffle_entrants (0015) returned handles only, so the pop-up had nothing to
-- draw a face with. It now returns avatar_path as well - the same picture
-- raffle_live (0016) already shows on the public live wheel. Postgres can't
-- change a function's result columns in place, so it is dropped and made
-- again.
--
-- donations records every paid Stripe checkout. Rows are written only by the
-- donation-status Edge Function with the service role key: there is no insert
-- or update policy, so nothing holding the public key can invent a gift.
-- donor_board() is its public face - donors who were signed in and left
-- "put me on the board" on, with the profile fields the site already shows
-- publicly (handle, picture) plus the nickname they chose, biggest total
-- first. Emails, first names and ages never leave profiles through it.

-- --------------------------------------------------------- raffle faces --

drop function if exists public.raffle_entrants(text);

create function public.raffle_entrants(p_raffle text)
returns table (handle text, avatar_path text, entered_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.instagram), ''), 'member'),
         p.avatar_path,
         e.created_at
  from public.raffle_entries e
  join public.profiles p on p.id = e.user_id
  where e.raffle_id = p_raffle
  order by e.created_at desc
  limit 1000;
$$;

revoke all on function public.raffle_entrants(text) from public;
grant execute on function public.raffle_entrants(text) to anon, authenticated;

-- ------------------------------------------------------------- donations --

create table if not exists public.donations (
  id                uuid        primary key default gen_random_uuid(),
  -- One row per paid checkout. donation-status upserts on this, so a reload
  -- of the thank-you page can never count a gift twice.
  stripe_session_id text        not null unique,
  -- Null for a guest. Taken from the donor's own session when the checkout
  -- was created, never from anything the browser sent.
  user_id           uuid        references auth.users on delete set null,
  amount_cents      int         not null check (amount_cents > 0),
  show_on_board     boolean     not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists donations_user_idx on public.donations (user_id);

alter table public.donations enable row level security;

drop policy if exists "admins read donations" on public.donations;
create policy "admins read donations" on public.donations for select
  using (public.is_admin());

-- ----------------------------------------------------------- donor board --

create or replace function public.donor_board()
returns table (
  handle       text,
  display_name text,
  avatar_path  text,
  total_cents  bigint,
  gifts        bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(p.instagram), ''),
         nullif(btrim(p.nickname), ''),
         p.avatar_path,
         sum(d.amount_cents)::bigint,
         count(*)::bigint
  from public.donations d
  join public.profiles p on p.id = d.user_id
  where d.show_on_board
  group by p.id, p.instagram, p.nickname, p.avatar_path
  order by sum(d.amount_cents) desc, min(d.created_at) asc
  limit 100;
$$;

revoke all on function public.donor_board() from public;
grant execute on function public.donor_board() to anon, authenticated;
