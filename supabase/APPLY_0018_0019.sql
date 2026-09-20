-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Migrations 0018 and 0019, and nothing else.
--
-- 0018 is in here even though you have already run it. Every
-- statement is written to survive a second run, and re-running
-- it costs nothing - whereas guessing wrong about whether it
-- took is what left the events table without its columns last
-- time. If it is already applied, this is a no-op.
--
-- The check at the bottom prints one row per change, so there
-- is no guessing this time either.
-- =============================================================


-- ==================== 0018: event photos + ticket link ====================

-- Event photos and an outside ticket link.
--
-- Two columns on public.events, both nullable, both safe to run twice.
--
-- The first version of this migration was written but never pasted into the
-- SQL editor, while the code that selects the column shipped - so PostgREST
-- rejected the whole select and the events list went dark on the dashboard and
-- fell back to the bundled dates on the public site. lib/admin-data.ts now
-- retries without these columns when they are missing, the way it already does
-- for 0006 and 0011, so the same mistake degrades instead of breaking.

-- ------------------------------------------------------ outside ticketing --

-- Where to send someone instead of selling them a ticket here. Null means the
-- site's own picker, which is what every existing row wants.
alter table public.events
  add column if not exists ticket_redirect_url text;

-- ------------------------------------------------------------- the photos --

-- Paths in the public site-images bucket, in the order they should be shown.
-- The first is the flyer - what a listing card and a shared link preview use.
--
-- An array rather than a photos table: five is the ceiling, they are always
-- read together with the event and never queried on their own, and ordering is
-- the array's own index rather than a sort column that has to be kept tidy.
alter table public.events
  add column if not exists photo_paths text[] not null default '{}';

-- Five is a flyer plus four. The check is here rather than only in the form,
-- because the form is not what the database is protecting itself from.
alter table public.events
  drop constraint if exists events_photo_paths_max;
alter table public.events
  add constraint events_photo_paths_max check (cardinality(photo_paths) <= 5);

-- flyer_url stays. Every date already posted points at a Posh flyer through
-- it, and the runtime list still falls back to it when a row has no uploads.
-- The form no longer offers it; nothing needs it removed from the table.

-- ==================== 0019: song requests ====================

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

-- Dropped first, every time. CREATE POLICY has no IF NOT EXISTS, so without
-- this a second run dies on the first policy and takes everything after it
-- with it - which is exactly how the events columns went missing for a week.
drop policy if exists "read own song requests" on public.song_requests;
create policy "read own song requests" on public.song_requests for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "add own song request" on public.song_requests;
create policy "add own song request" on public.song_requests for insert
  with check (auth.uid() = user_id);

-- Withdrawing one is allowed; editing it is not. An edit would let the row be
-- rewritten after the fact, and there is nothing a change would do that
-- deleting and asking again does not.
drop policy if exists "withdraw own song request" on public.song_requests;
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

-- Every `present` should read true.

select 'events.ticket_redirect_url' as thing,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'events' and column_name = 'ticket_redirect_url'
       ) as present
union all
select 'events.photo_paths',
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'events' and column_name = 'photo_paths'
       )
union all
select 'photo cap (max 5)',
       exists (select 1 from pg_constraint where conname = 'events_photo_paths_max')
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
           and table_name = 'song_requests' and column_name = 'link'
       )
union all
select 'YouTube-only link rule',
       exists (select 1 from pg_constraint where conname = 'song_requests_link_youtube')
union all
select 'five-per-night trigger',
       exists (select 1 from pg_trigger where tgname = 'on_song_request_insert')
union all
select 'site-images bucket',
       exists (select 1 from storage.buckets where id = 'site-images');
