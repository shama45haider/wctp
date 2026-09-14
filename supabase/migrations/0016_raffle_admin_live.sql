-- Raffle details run from the dashboard, and a live draw anyone with the link
-- can watch.
--
-- 0015 kept the prizes in the page. They live on the raffle row now, so the
-- dashboard can change them and start a new raffle without a deploy. The
-- site's pop-up shows the newest raffle that is `visible`.
--
-- A live draw is a session with a random token and a one-hour life. The token
-- is the only way in: raffle_live() answers for a live token and says
-- "expired" for anything else, so a shared link stops working on its own.
-- Winners are picked here, in raffle_draw(), never in a browser - every viewer
-- animates the same stored result, so everyone watching sees the same winner.

-- ---------------------------------------------------------------- raffles --

alter table public.raffles add column if not exists blurb text;
alter table public.raffles add column if not exists prizes jsonb not null default '[]'::jsonb;
alter table public.raffles add column if not exists visible boolean not null default true;
alter table public.raffles add column if not exists updated_at timestamptz not null default now();

-- The first raffle's prizes, moved out of the page they used to be written in.
update public.raffles
set blurb = coalesce(blurb, 'Three winners. One entry each. All you need is a verified account.'),
    prizes = '[
      {"place": "1ST PLACE", "items": ["7g of Za", "Vampire Punch", "Element Papers"]},
      {"place": "2ND PLACE", "items": ["3.5g of Za", "Grabba", "Bracelet"]},
      {"place": "3RD PLACE", "items": ["Vampire Punch", "Glow Bracelet"]}
    ]'::jsonb
where id = 'wctp-raffle-1' and prizes = '[]'::jsonb;

-- A hidden raffle is a draft, and drafts stay with admins.
drop policy if exists "anyone reads raffles" on public.raffles;
create policy "anyone reads raffles" on public.raffles for select
  using (visible or public.is_admin());

-- Entering also needs the raffle to be on the site.
drop policy if exists "eligible members enter open raffles" on public.raffle_entries;
create policy "eligible members enter open raffles" on public.raffle_entries for insert
  with check (
    auth.uid() = user_id
    and public.raffle_eligible()
    and exists (
      select 1 from public.raffles r
      where r.id = raffle_id and r.open and r.visible
    )
  );

-- The dashboard's entry list, with enough to reach a winner. Empty for
-- anyone who isn't an admin.
create or replace function public.raffle_admin_entries(p_raffle text)
returns table (
  user_id     uuid,
  handle      text,
  email       text,
  first_name  text,
  avatar_path text,
  entered_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.user_id,
         coalesce(nullif(btrim(p.instagram), ''), 'member'),
         p.email,
         p.first_name,
         p.avatar_path,
         e.created_at
  from public.raffle_entries e
  join public.profiles p on p.id = e.user_id
  where e.raffle_id = p_raffle
    and public.is_admin()
  order by e.created_at;
$$;

-- ---------------------------------------------------------- live sessions --

create table if not exists public.raffle_live_sessions (
  token      text        primary key,
  raffle_id  text        not null references public.raffles on delete cascade,
  created_by uuid        references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at   timestamptz
);

create index if not exists raffle_live_sessions_raffle_idx
  on public.raffle_live_sessions (raffle_id, created_at desc);

alter table public.raffle_live_sessions enable row level security;

-- Guests never read this table; they go through raffle_live() with a token.
drop policy if exists "admins manage live sessions" on public.raffle_live_sessions;
create policy "admins manage live sessions" on public.raffle_live_sessions for all
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------------ draws --

create table if not exists public.raffle_draws (
  raffle_id   text        not null references public.raffles on delete cascade,
  place       int         not null check (place between 1 and 50),
  user_id     uuid        not null references auth.users on delete cascade,
  -- Where inside the winner's slice the wheel stops, 0..1, so every viewer's
  -- wheel lands on exactly the same spot.
  spin_offset real        not null,
  drawn_by    uuid        references auth.users default auth.uid(),
  drawn_at    timestamptz not null default now(),
  primary key (raffle_id, place),
  -- Nobody wins twice.
  unique (raffle_id, user_id)
);

alter table public.raffle_draws enable row level security;

-- No insert policy: a draw only ever comes from raffle_draw().
drop policy if exists "admins read draws" on public.raffle_draws;
create policy "admins read draws" on public.raffle_draws for select
  using (public.is_admin());

drop policy if exists "admins clear draws" on public.raffle_draws;
create policy "admins clear draws" on public.raffle_draws for delete
  using (public.is_admin());

-- -------------------------------------------------------------- functions --

-- Starts a one-hour live link, ending any earlier one, and closes entries so
-- the wheel can't change while it's being spun.
create or replace function public.raffle_go_live(p_raffle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token   text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + interval '1 hour';
begin
  if not public.is_admin() then
    raise exception 'Only an admin can start a live draw.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.raffles where id = p_raffle) then
    raise exception 'There is no raffle with that id.';
  end if;

  update public.raffle_live_sessions
     set ended_at = now()
   where raffle_id = p_raffle and ended_at is null;

  update public.raffles
     set open = false, updated_at = now()
   where id = p_raffle;

  insert into public.raffle_live_sessions (token, raffle_id, expires_at)
  values (v_token, p_raffle, v_expires);

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;

create or replace function public.raffle_end_live(p_raffle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can end a live draw.' using errcode = '42501';
  end if;
  update public.raffle_live_sessions
     set ended_at = now()
   where raffle_id = p_raffle and ended_at is null;
end;
$$;

-- Picks the winner for one place at random from everyone who hasn't already
-- won, and records it. Only while a live link is open, so there's always an
-- audience for the spin.
create or replace function public.raffle_draw(p_raffle text, p_place int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_places int;
  v_winner uuid;
  v_offset real := (0.15 + random() * 0.7)::real;
  v_at     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can spin the wheel.' using errcode = '42501';
  end if;

  select jsonb_array_length(prizes) into v_places
  from public.raffles where id = p_raffle;
  if v_places is null then
    raise exception 'There is no raffle with that id.';
  end if;
  if p_place < 1 or p_place > v_places then
    raise exception 'There is no prize for that place.';
  end if;

  if not exists (
    select 1 from public.raffle_live_sessions s
    where s.raffle_id = p_raffle and s.ended_at is null and s.expires_at > now()
  ) then
    raise exception 'Go live first - the wheel only spins while the live link is open.';
  end if;

  if exists (
    select 1 from public.raffle_draws d
    where d.raffle_id = p_raffle and d.place = p_place
  ) then
    raise exception 'That place already has a winner. Clear it to spin again.';
  end if;

  select e.user_id into v_winner
  from public.raffle_entries e
  where e.raffle_id = p_raffle
    and not exists (
      select 1 from public.raffle_draws d
      where d.raffle_id = p_raffle and d.user_id = e.user_id
    )
  order by random()
  limit 1;

  if v_winner is null then
    raise exception 'Nobody left on the wheel to draw.';
  end if;

  insert into public.raffle_draws (raffle_id, place, user_id, spin_offset)
  values (p_raffle, p_place, v_winner, v_offset)
  returning drawn_at into v_at;

  return jsonb_build_object(
    'place', p_place,
    'key', md5(v_winner::text),
    'spin_offset', v_offset,
    'drawn_at', v_at
  );
end;
$$;

-- Everything a live page needs, for a live token only. Entrants carry a
-- one-way key instead of their user id, plus the handle and picture already
-- shown publicly on the site.
create or replace function public.raffle_live(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.raffle_live_sessions%rowtype;
  r public.raffles%rowtype;
begin
  select * into s from public.raffle_live_sessions where token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if s.ended_at is not null or s.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select * into r from public.raffles where id = s.raffle_id;

  return jsonb_build_object(
    'status', 'live',
    'server_now', now(),
    'expires_at', s.expires_at,
    'raffle', jsonb_build_object('id', r.id, 'title', r.title, 'prizes', r.prizes),
    'entrants', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'key', md5(e.user_id::text),
                 'handle', coalesce(nullif(btrim(p.instagram), ''), 'member'),
                 'avatar_path', p.avatar_path,
                 'entered_at', e.created_at
               )
               order by e.created_at, e.user_id
             )
      from public.raffle_entries e
      join public.profiles p on p.id = e.user_id
      where e.raffle_id = r.id
    ), '[]'::jsonb),
    'draws', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'place', d.place,
                 'key', md5(d.user_id::text),
                 'spin_offset', d.spin_offset,
                 'drawn_at', d.drawn_at
               )
               order by d.drawn_at
             )
      from public.raffle_draws d
      where d.raffle_id = r.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.raffle_live(text) from public;
grant execute on function public.raffle_live(text) to anon, authenticated;

revoke all on function public.raffle_go_live(text) from public;
grant execute on function public.raffle_go_live(text) to authenticated;

revoke all on function public.raffle_end_live(text) from public;
grant execute on function public.raffle_end_live(text) to authenticated;

revoke all on function public.raffle_draw(text, int) from public;
grant execute on function public.raffle_draw(text, int) to authenticated;

revoke all on function public.raffle_admin_entries(text) from public;
grant execute on function public.raffle_admin_entries(text) to authenticated;
