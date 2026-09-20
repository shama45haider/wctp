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
