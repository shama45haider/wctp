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
select 'raffle_entrants has avatar_path',
       exists (
         select 1
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'raffle_entrants'
           and 'avatar_path' = any(p.proargnames)
       );
