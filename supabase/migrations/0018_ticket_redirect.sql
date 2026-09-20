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
