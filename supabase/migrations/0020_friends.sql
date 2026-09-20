-- Friends, found by Instagram handle.
--
-- A handle is already what an account is called here (see 0011), so there is
-- no new identity to invent - you add someone by the name they already go by.
--
-- Nothing in this file lets one guest read another's profile row. Profiles
-- stay locked to their owner; the two functions below are security definer and
-- hand back only a handle and a picture, which is what a friend list needs and
-- the whole of what it gets.

create table if not exists public.friendships (
  requester_id uuid        not null references auth.users on delete cascade,
  addressee_id uuid        not null references auth.users on delete cascade,
  status       text        not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,

  primary key (requester_id, addressee_id),
  constraint friendships_status  check (status in ('pending', 'accepted')),
  constraint friendships_no_self check (requester_id <> addressee_id)
);

-- One pair, one row, whichever way round it was asked.
--
-- Without this, A asks B, B asks A, and both sit pending forever with each
-- person looking at a request the other has already sent them.
create unique index if not exists friendships_pair
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

alter table public.friendships enable row level security;

drop policy if exists "read own friendships" on public.friendships;
create policy "read own friendships" on public.friendships for select
  using (auth.uid() in (requester_id, addressee_id) or public.is_admin());

drop policy if exists "send own friend request" on public.friendships;
create policy "send own friend request" on public.friendships for insert
  with check (auth.uid() = requester_id and status = 'pending');

-- Only the person who was asked can accept, and accepting is the only edit
-- there is. Without the WITH CHECK an addressee could update the row back to
-- pending, or a requester could mark their own request accepted.
drop policy if exists "accept a friend request" on public.friendships;
create policy "accept a friend request" on public.friendships for update
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status = 'accepted');

-- Either side can walk away, at any point. Declining and unfriending are the
-- same act as far as the table is concerned.
drop policy if exists "remove own friendship" on public.friendships;
create policy "remove own friendship" on public.friendships for delete
  using (auth.uid() in (requester_id, addressee_id) or public.is_admin());

-- ------------------------------------------------------------- finding one --

-- The handle an account goes by: its Instagram handle, or its name for an
-- account old enough not to have one.
create or replace function public.member_handle(p public.profiles)
returns text
language sql
immutable
as $$
  select nullif(btrim(coalesce(nullif(btrim(p.instagram), ''), p.name)), '');
$$;

/**
 * One member, by exact handle.
 *
 * Exact and case-insensitive, never a prefix or a LIKE: a partial match would
 * turn this into a way to walk the whole membership list one letter at a time.
 * A leading @ is tolerated because people paste handles with one.
 *
 * Security definer because profiles is readable only by its owner, and a
 * friend request has to be addressable to somebody you cannot otherwise see.
 * It returns an id, a handle and a picture - nothing that is not already on
 * the raffle wheel.
 */
create or replace function public.find_member(p_handle text)
returns table (id uuid, handle text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, public.member_handle(p), p.avatar_path
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and lower(public.member_handle(p)) = lower(btrim(ltrim(btrim(p_handle), '@')))
  limit 1;
$$;

revoke all on function public.find_member(text) from public;
grant execute on function public.find_member(text) to authenticated;

/**
 * This account's friends and outstanding requests, with the handle and picture
 * needed to draw them.
 *
 * `direction` says who asked, which is what decides whether a pending row
 * shows an Accept button or the word "sent".
 */
create or replace function public.my_friends()
returns table (
  user_id     uuid,
  handle      text,
  avatar_path text,
  status      text,
  direction   text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
    public.member_handle(p),
    p.avatar_path,
    f.status,
    case when f.requester_id = auth.uid() then 'sent' else 'received' end,
    f.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by f.status asc, f.created_at desc;
$$;

revoke all on function public.my_friends() from public;
grant execute on function public.my_friends() to authenticated;
