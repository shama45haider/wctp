-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Migrations 0020, 0021 and 0022: friends, XP, and the room.
-- Run 0018 and 0019 first if you have not (APPLY_0018_0019.sql).
--
-- Every statement is written to survive a second run. The check
-- at the bottom prints one row per piece, so there is no
-- guessing whether it took.
--
-- One thing to know before you paste it: the chat storage
-- policies at the end touch storage.objects, which has failed on
-- permissions in this project before (see the note atop 0003).
-- They are last on purpose - if that block is the only thing
-- that errors, everything above it has already committed, and
-- the bucket policies can be added from Storage -> Policies
-- instead.
-- =============================================================


-- ==================== 0020: friends ====================

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


-- ==================== 0021: XP ====================

-- XP.
--
-- Worked out from what already happened, never stored.
--
-- There is no xp column and no ledger of awards, on purpose. A stored total is
-- a number somebody has to be trusted not to write, and every path that could
-- write it - a trigger, an admin tool, a client with the wrong key - is a way
-- for the board to become fiction. Counting the source rows on read means the
-- only way to gain XP is to do the thing: get scanned at a door, buy a ticket,
-- have a friend request accepted, ask for a track, enter a raffle.
--
-- It also means XP corrects itself. A cancelled order stops counting the
-- moment it is cancelled, and a revoked pass stops the moment it is revoked,
-- without anything having to remember to go back and subtract.

-- Whether this account appears on the public board. Visible by default - a
-- board nobody is on is not a board - and switched off from /profile.
alter table public.profiles
  add column if not exists show_on_leaderboard boolean not null default true;

-- ------------------------------------------------------------ what it costs --

/**
 * One member's XP, and where it came from.
 *
 * Returned as a breakdown rather than a single number so the dashboard can
 * show its working. Somebody who cannot see why they have 340 has no reason to
 * believe the 340.
 *
 * Security definer: it reads orders, passes and raffle entries belonging to
 * whoever is being counted, which row-level security rightly hides from
 * everyone else. Nothing identifying comes back - only totals.
 */
create or replace function public.member_xp(p_user uuid)
returns table (
  attended      int,
  tickets       int,
  friends       int,
  requests      int,
  raffles       int,
  attended_xp   int,
  tickets_xp    int,
  friends_xp    int,
  requests_xp   int,
  raffles_xp    int,
  total         int
)
language sql
stable
security definer
set search_path = public
as $$
  with
  -- Scanned at a door, and not revoked afterwards. The strongest signal the
  -- site has that a person was actually in the room, so it pays the most.
  a as (
    select count(*)::int n
    from public.passes ps
    join public.orders o on o.id = ps.order_id
    where o.user_id = p_user
      and o.cancelled_at is null
      and ps.used_at is not null
      and ps.revoked_at is null
  ),
  -- Orders that still stand. Worth less than turning up, because buying a
  -- ticket and staying in is not the same as coming.
  t as (
    select count(*)::int n
    from public.orders o
    where o.user_id = p_user and o.cancelled_at is null
  ),
  -- Capped at twenty, and only once both sides agreed. Uncapped, two alt
  -- accounts adding each other all afternoon would out-earn a regular.
  f as (
    select least(count(*), 20)::int n
    from public.friendships fr
    where fr.status = 'accepted'
      and p_user in (fr.requester_id, fr.addressee_id)
  ),
  r as (
    select count(*)::int n from public.song_requests sr where sr.user_id = p_user
  ),
  q as (
    select count(*)::int n from public.raffle_entries re where re.user_id = p_user
  )
  select
    a.n, t.n, f.n, r.n, q.n,
    a.n * 100, t.n * 25, f.n * 10, r.n * 5, q.n * 5,
    a.n * 100 + t.n * 25 + f.n * 10 + r.n * 5 + q.n * 5
  from a, t, f, r, q;
$$;

revoke all on function public.member_xp(uuid) from public;
grant execute on function public.member_xp(uuid) to authenticated;

/** The signed-in member's own breakdown. */
create or replace function public.my_xp()
returns table (
  attended    int, tickets int, friends int, requests int, raffles int,
  attended_xp int, tickets_xp int, friends_xp int, requests_xp int, raffles_xp int,
  total       int
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.member_xp(auth.uid());
$$;

revoke all on function public.my_xp() from public;
grant execute on function public.my_xp() to authenticated;

-- ------------------------------------------------------------- the board ---

/**
 * The top of the board.
 *
 * Only accounts that have not opted out, and only ever a handle, a picture and
 * a total. Deliberately not the breakdown: how many parties a named person has
 * been to is a different thing to publish than their score, and the board does
 * not need it to rank anyone.
 *
 * Shaped after donor_board() in 0017, including the tie-break, so two people on
 * the same score do not swap places between page loads.
 */
create or replace function public.xp_board(p_limit int default 50)
returns table (
  handle      text,
  avatar_path text,
  total       int
)
language sql
stable
security definer
set search_path = public
as $$
  with
  -- Aggregated once across everybody rather than by calling member_xp() per
  -- profile. The lateral version was five counts times one row per member,
  -- which is fine at forty members and not at four thousand.
  att as (
    select o.user_id uid, count(*) n
    from public.passes ps
    join public.orders o on o.id = ps.order_id
    where o.cancelled_at is null
      and ps.used_at is not null
      and ps.revoked_at is null
    group by o.user_id
  ),
  tix as (
    select user_id uid, count(*) n
    from public.orders where cancelled_at is null group by user_id
  ),
  fr as (
    select uid, least(count(*), 20) n
    from (
      select requester_id uid from public.friendships where status = 'accepted'
      union all
      select addressee_id     from public.friendships where status = 'accepted'
    ) both_sides
    group by uid
  ),
  req as (select user_id uid, count(*) n from public.song_requests group by user_id),
  raf as (select user_id uid, count(*) n from public.raffle_entries group by user_id)
  select scored.handle, scored.avatar_path, scored.total
  from (
    select
      public.member_handle(p) as handle,
      p.avatar_path,
      (coalesce(att.n, 0) * 100
        + coalesce(tix.n, 0) * 25
        + coalesce(fr.n, 0)  * 10
        + coalesce(req.n, 0) * 5
        + coalesce(raf.n, 0) * 5)::int as total
    from public.profiles p
    left join att on att.uid = p.id
    left join tix on tix.uid = p.id
    left join fr  on fr.uid  = p.id
    left join req on req.uid = p.id
    left join raf on raf.uid = p.id
    where coalesce(p.show_on_leaderboard, true)
      and public.member_handle(p) is not null
  ) scored
  -- Wrapped so the score can be filtered on: everyone who has done nothing
  -- yet scores zero, and a board that is mostly zeroes ranks nobody.
  where scored.total > 0
  order by scored.total desc, scored.handle asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.xp_board(int) from public;
grant execute on function public.xp_board(int) to anon, authenticated;


-- ==================== 0022: the room ====================

-- The room.
--
-- One shared chat. Anyone signed in can read it; only an age-verified account
-- can post. That gate is not decoration - this site verifies age because
-- under-18s do sign up, and a room with image posting is the last place to let
-- an unreviewed account talk.
--
-- The site is a static export, so there is no server between a browser and
-- this table. Every rule below therefore has to be a policy, a constraint or a
-- trigger: anything enforced only in the React component is enforced only for
-- people who use the React component.

create table if not exists public.chat_messages (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users on delete cascade,
  body       text,
  -- Path in the chat-images bucket, for an uploaded picture.
  image_path text,
  -- A Giphy URL. Host-locked below for the same reason song request links are.
  gif_url    text,
  created_at timestamptz not null default now(),
  -- Set instead of deleting, so a moderator can see what was removed and by
  -- whom rather than the row simply vanishing from under an argument.
  hidden_at  timestamptz,
  hidden_by  uuid        references auth.users,

  constraint chat_body_len check (body is null or char_length(body) <= 600),
  -- A message has to be something. Without this, an empty row is a way to
  -- bump the room and push everything else up the screen.
  constraint chat_has_content check (
    coalesce(btrim(body), '') <> '' or image_path is not null or gif_url is not null
  ),
  constraint chat_gif_host check (
    gif_url is null
    or gif_url ~* '^https://([a-z0-9-]+\.)?(giphy\.com|giphy\.net)/'
  )
);

create index if not exists chat_messages_recent_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

-- Reading is for anyone with an account. Hidden messages are not served to
-- guests at all - a moderated message that still shows as "[removed]" is an
-- argument that carries on in the gaps.
drop policy if exists "members read the room" on public.chat_messages;
create policy "members read the room" on public.chat_messages for select
  using (
    auth.uid() is not null
    and (hidden_at is null or public.is_admin())
  );

-- Posting needs a verified account. profiles.verified is written only by the
-- review trigger in 0002, never by a client, so this cannot be self-granted.
drop policy if exists "verified members post" on public.chat_messages;
create policy "verified members post" on public.chat_messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.verified
    )
  );

-- Taking your own words back, or a moderator taking anyone's. This is the
-- update path and it may only ever hide.
drop policy if exists "hide a message" on public.chat_messages;
create policy "hide a message" on public.chat_messages for update
  using ((auth.uid() = user_id or public.is_admin()) and hidden_at is null)
  with check (hidden_at is not null);

drop policy if exists "admins delete messages" on public.chat_messages;
create policy "admins delete messages" on public.chat_messages for delete
  using (public.is_admin());

-- ------------------------------------------------------------ slowing down --

/**
 * Ten messages a minute, per person.
 *
 * Not an anti-spam system - it is a floor under one. A determined person with
 * the anon key and a loop can still post ten a minute forever, and the answer
 * to that is a moderator, not a trigger. What this stops is the accidental
 * version: a held key, a retry loop, a bored teenager with the console open.
 */
create or replace function public.limit_chat_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.chat_messages
   where user_id = new.user_id
     and created_at > now() - interval '1 minute';

  if recent >= 10 then
    raise exception 'Slow down a second.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists on_chat_message_insert on public.chat_messages;
create trigger on_chat_message_insert
  before insert on public.chat_messages
  for each row execute function public.limit_chat_rate();

-- --------------------------------------------------------------- the faces --

/**
 * Recent messages with the handle and picture to draw each one.
 *
 * A join to profiles would return nothing for other people's rows, since
 * profiles is readable only by its owner. Security definer, and it hands back
 * only what a chat line shows.
 */
create or replace function public.chat_recent(p_limit int default 100)
returns table (
  id          uuid,
  user_id     uuid,
  handle      text,
  avatar_path text,
  body        text,
  image_path  text,
  gif_url     text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.user_id, public.member_handle(p), p.avatar_path,
         m.body, m.image_path, m.gif_url, m.created_at
  from public.chat_messages m
  join public.profiles p on p.id = m.user_id
  where auth.uid() is not null
    and m.hidden_at is null
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.chat_recent(int) from public;
grant execute on function public.chat_recent(int) to authenticated;

-- --------------------------------------------------------------- pictures --

-- Its own bucket, not site-images: that one is admin-write (0012) and this is
-- the one place guests upload something everybody else sees.
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do update set public = true;

-- Verified accounts only, and only into a folder named for their own user id -
-- the same shape as the id-documents rule in 0002, so a path cannot be
-- forged to look like it came from somebody else.
drop policy if exists "verified members upload chat images" on storage.objects;
create policy "verified members upload chat images" on storage.objects for insert
  with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.verified)
  );

drop policy if exists "admins delete chat images" on storage.objects;
create policy "admins delete chat images" on storage.objects for delete
  using (bucket_id = 'chat-images' and public.is_admin());

-- Reading needs no policy: the bucket is public, which is what lets a message
-- render for everyone in the room.


-- ---------- did it work? ----------

select 'friendships table' as thing,
       exists (select 1 from information_schema.tables
               where table_schema='public' and table_name='friendships') as present
union all
select 'find_member()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='find_member')
union all
select 'my_friends()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='my_friends')
union all
select 'profiles.show_on_leaderboard',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='profiles'
                 and column_name='show_on_leaderboard')
union all
select 'member_xp()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='member_xp')
union all
select 'xp_board()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='xp_board')
union all
select 'chat_messages table',
       exists (select 1 from information_schema.tables
               where table_schema='public' and table_name='chat_messages')
union all
select 'chat_recent()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='chat_recent')
union all
select 'ten-a-minute trigger',
       exists (select 1 from pg_trigger where tgname='on_chat_message_insert')
union all
select 'chat-images bucket',
       exists (select 1 from storage.buckets where id='chat-images');
