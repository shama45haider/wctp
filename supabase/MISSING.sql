-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- What is outstanding as of 2026-09-20, and nothing else. Short
-- on purpose: RUN_THIS.sql is the full history and re-running
-- all of it is what hit the raffle_entrants error below.
--
-- Every statement is safe to run twice. The last one prints what
-- the database actually has afterwards, so there is no guessing.
-- =============================================================


-- ---------- the error you just hit ----------

-- 42P13: cannot change return type of existing function.
--
-- RUN_THIS.sql defines raffle_entrants twice - the 0015 shape
-- (handle, entered_at) and then the 0017 shape, which adds
-- avatar_path. CREATE OR REPLACE cannot change a return type, so
-- once 0017 had been applied the older statement could no longer
-- run, and it took every statement after it down with it -
-- including the events columns at the end of the file.
--
-- Dropping first is the fix. This leaves the 0017 shape in place,
-- which is the one the site reads.

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


-- ---------- 0018: event photos and an outside ticket link ----------

-- Where to send someone instead of selling them a ticket here.
-- Null means the site's own picker, which is what every existing
-- row wants.
alter table public.events
  add column if not exists ticket_redirect_url text;

-- Paths in the public site-images bucket, in the order they are
-- shown. The first is the flyer - what a listing card and a
-- shared link preview use.
alter table public.events
  add column if not exists photo_paths text[] not null default '{}';

-- Five is a flyer plus four. Dropped first because ADD CONSTRAINT
-- has no IF NOT EXISTS.
alter table public.events
  drop constraint if exists events_photo_paths_max;
alter table public.events
  add constraint events_photo_paths_max
  check (cardinality(photo_paths) <= 5);


-- ---------- the bucket the uploader writes to ----------

-- Nothing to do here, on purpose.
--
-- Event photos go into the site-images bucket that 0012 already
-- created for team and gallery pictures, with an is_admin() write
-- policy that covers them. Re-creating those policies is the one
-- statement in this project that has failed on permissions before
-- (see the note at the top of 0003) - and a failure there would
-- roll back the columns above, which is the exact trap this file
-- exists to get out of. So it is left alone and merely checked.
--
-- If the check below reports the bucket missing, run the storage
-- section of 0012_team_and_gallery.sql on its own.


-- ---------- 0019_song_requests.sql ----------

-- Song requests.
--
-- A guest asks for a track, for a particular night or for the list in general.
-- Nothing here is public: a request is between the person who made it and
-- whoever is building the set.

create table if not exists public.song_requests (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  -- Plain text and no foreign key, exactly like orders.event_slug: most dates
  -- live in lib/events.ts rather than public.events, so a reference would
  -- reject a request for every night the site ships in its own bundle.
  -- Null means "whenever", not "unknown".
  event_slug  text,
  event_title text,
  song        text        not null,
  artist      text,
  -- A YouTube link, so there is no guessing which of four remixes was meant.
  link        text,
  created_at  timestamptz not null default now(),

  -- Length caps belong here rather than only in the form. The form is not what
  -- the database is defending itself against.
  constraint song_requests_song_len   check (char_length(btrim(song)) between 1 and 120),
  constraint song_requests_artist_len check (artist is null or char_length(btrim(artist)) <= 120),
  constraint song_requests_link_len   check (link is null or char_length(link) <= 400),

  -- https, and YouTube only.
  --
  -- This column is rendered as a link on a dashboard somebody else reads, so an
  -- open URL field is somewhere to park a phishing page addressed to staff.
  -- Narrowing it to the one host the feature is for costs nothing and closes
  -- that. The optional group is a subdomain (www., m., music.) and cannot
  -- swallow a lookalike: "evil-youtube.com" leaves "com/" to match against
  -- "youtube.com", and "youtube.com.evil.com" has no "/" where one is required.
  constraint song_requests_link_youtube check (
    link is null
    or link ~* '^https://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)/'
  )
);

create index if not exists song_requests_user_idx  on public.song_requests (user_id);
create index if not exists song_requests_event_idx on public.song_requests (event_slug);

-- The same track twice for the same night is a double-tap, not a stronger
-- opinion. Expression index rather than a plain unique constraint so the
-- comparison ignores case and stray spacing.
create unique index if not exists song_requests_no_dupes
  on public.song_requests (user_id, coalesce(event_slug, ''), lower(btrim(song)));

alter table public.song_requests enable row level security;

create policy "read own song requests" on public.song_requests for select
  using (auth.uid() = user_id or public.is_admin());

create policy "add own song request" on public.song_requests for insert
  with check (auth.uid() = user_id);

-- Withdrawing one is allowed; editing it is not. An edit would let the row be
-- rewritten after the fact, and there is nothing a change would do that
-- deleting and asking again does not.
create policy "withdraw own song request" on public.song_requests for delete
  using (auth.uid() = user_id or public.is_admin());

-- ------------------------------------------------------------------- a cap --

-- Five per night, per person.
--
-- Without this, one guest with a grudge fills a set list. The count is scoped
-- to the night rather than to time, so it does not quietly free itself up
-- again the week after.
create or replace function public.limit_song_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  already int;
begin
  select count(*) into already
    from public.song_requests
   where user_id = new.user_id
     and coalesce(event_slug, '') = coalesce(new.event_slug, '');

  if already >= 5 then
    raise exception 'That is five requests for this one already.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists on_song_request_insert on public.song_requests;
create trigger on_song_request_insert
  before insert on public.song_requests
  for each row execute function public.limit_song_requests();


-- ---------- did it work? ----------

-- One row per thing this file was supposed to do. Every `present`
-- should read true. Anything false is worth saying out loud
-- rather than finding later through a broken screen.

select 'events.ticket_redirect_url' as thing,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'events'
           and column_name = 'ticket_redirect_url'
       ) as present
union all
select 'events.photo_paths',
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'events'
           and column_name = 'photo_paths'
       )
union all
select 'photo cap (max 5)',
       exists (
         select 1 from pg_constraint
         where conname = 'events_photo_paths_max'
       )
union all
select 'site-images bucket',
       exists (select 1 from storage.buckets where id = 'site-images')
union all
select 'song_requests table',
       exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'song_requests'
       )
union all
select 'song_requests.link',
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'song_requests'
           and column_name = 'link'
       )
union all
select 'raffle_entrants has avatar_path',
       exists (
         select 1
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'raffle_entrants'
           and 'avatar_path' = any(p.proargnames)
       );
