-- A members' raffle: guests with a verified ID enter once, and anyone can see
-- who is in. "Verified" is the same bar as an RSVP - an admin approved their
-- ID (0002) - and it is the database, not the page, that holds entries to it.

-- ---------------------------------------------------------------- raffles --

create table if not exists public.raffles (
  id         text        primary key,
  title      text        not null,
  open       boolean     not null default true,
  created_at timestamptz not null default now()
);

alter table public.raffles enable row level security;

drop policy if exists "anyone reads raffles" on public.raffles;
create policy "anyone reads raffles" on public.raffles for select
  using (true);

drop policy if exists "admins write raffles" on public.raffles;
create policy "admins write raffles" on public.raffles for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.raffles (id, title)
values ('wctp-raffle-1', 'The WCTP Raffle')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- entries --

create table if not exists public.raffle_entries (
  raffle_id  text        not null references public.raffles on delete cascade,
  user_id    uuid        not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  -- One entry per person per raffle.
  primary key (raffle_id, user_id)
);

alter table public.raffle_entries enable row level security;

-- Whether the caller may enter: signed in and verified by an admin. No
-- argument on purpose, so it can't be used to ask about anyone else.
create or replace function public.raffle_eligible()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.verified
  );
$$;

drop policy if exists "read own raffle entries" on public.raffle_entries;
create policy "read own raffle entries" on public.raffle_entries for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "eligible members enter open raffles" on public.raffle_entries;
create policy "eligible members enter open raffles" on public.raffle_entries for insert
  with check (
    auth.uid() = user_id
    and public.raffle_eligible()
    and exists (select 1 from public.raffles r where r.id = raffle_id and r.open)
  );

drop policy if exists "admins remove raffle entries" on public.raffle_entries;
create policy "admins remove raffle entries" on public.raffle_entries for delete
  using (public.is_admin());

-- The public entry list. Instagram handles and entry times only - no names,
-- emails or ages leave profiles through this.
create or replace function public.raffle_entrants(p_raffle text)
returns table (handle text, entered_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.instagram), ''), 'member') as handle,
         e.created_at as entered_at
  from public.raffle_entries e
  join public.profiles p on p.id = e.user_id
  where e.raffle_id = p_raffle
  order by e.created_at desc
  limit 1000;
$$;

revoke all on function public.raffle_entrants(text) from public;
grant execute on function public.raffle_entrants(text) to anon, authenticated;
