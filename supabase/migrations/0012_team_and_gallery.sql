-- Team members and gallery photos an admin can edit from the site itself.
--
-- Both pages used to be fixed: /team rendered the hardcoded roster in
-- lib/artists.ts, and /gallery showed event flyers and whatever the
-- Instagram fetch had picked up. Neither could be changed without editing
-- source and redeploying, which is the same trap the event list was in
-- before public.events existed - so these follow that table's shape exactly:
-- anyone may read what is published, only an admin may write, and the site
-- merges what it finds here on top of what shipped in the bundle.

-- ------------------------------------------------------------ the images --

-- Public, like avatars and unlike id-documents: a team photo and a gallery
-- shot are both meant to be looked at by anyone who opens the page, and
-- serving them through signed links that expire would mean re-fetching one
-- every render. Nothing private ever goes in here.
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do update set public = true;

-- Only an admin writes. Guests upload to avatars and id-documents under
-- their own user id; this bucket is the site's own furniture, so the check
-- is is_admin() rather than a folder name.
drop policy if exists "admins upload site images" on storage.objects;
create policy "admins upload site images" on storage.objects for insert
  with check (bucket_id = 'site-images' and public.is_admin());

drop policy if exists "admins replace site images" on storage.objects;
create policy "admins replace site images" on storage.objects for update
  using (bucket_id = 'site-images' and public.is_admin());

drop policy if exists "admins delete site images" on storage.objects;
create policy "admins delete site images" on storage.objects for delete
  using (bucket_id = 'site-images' and public.is_admin());

-- Reading needs no policy: the bucket is public, which is the point.

-- ------------------------------------------------------------------ team --

-- `slot` is the identity, not a generated id: lib/artists.ts numbers its
-- roster 1..6 and the page draws them in that order, so a row written here
-- against slot 3 is an edit of the third card rather than a seventh one.
-- Anything above the static roster's length is simply a new card.
create table if not exists public.team_members (
  slot        int primary key,
  role        text        not null default 'artist',
  name        text,
  title       text,
  bio         text,
  -- Path in the public site-images bucket. Falls back to the bundled
  -- imageUrl for a slot the static roster already has a photo for.
  image_path  text,
  instagram   text,
  soundcloud  text,
  -- An unpublished row hides that slot's card entirely rather than falling
  -- back to the bundled one, which is how a member who has left goes away
  -- without a deploy.
  published   boolean     not null default true,
  updated_by  uuid        references auth.users,
  updated_at  timestamptz not null default now()
);

alter table public.team_members enable row level security;

create policy "anyone reads team" on public.team_members for select
  using (true);

create policy "admins write team" on public.team_members for insert
  with check (public.is_admin());
create policy "admins update team" on public.team_members for update
  using (public.is_admin());
create policy "admins delete team" on public.team_members for delete
  using (public.is_admin());

-- --------------------------------------------------------------- gallery --

-- Photos from the nights themselves, which the site had nowhere to put: the
-- gallery could only ever show flyers and the Instagram feed, and neither is
-- a picture of the room. Ordered by `sort` ascending, newest-looking first
-- being whatever the admin decides rather than whatever the clock says.
create table if not exists public.gallery_items (
  id         uuid        primary key default gen_random_uuid(),
  image_path text        not null,
  caption    text,
  sort       int         not null default 0,
  published  boolean     not null default true,
  created_by uuid        references auth.users,
  created_at timestamptz not null default now()
);

create index if not exists gallery_items_sort_idx on public.gallery_items (sort, created_at);

alter table public.gallery_items enable row level security;

-- Drafts stay with the admin who wrote them, the same rule public.events
-- uses for an unpublished date.
create policy "anyone reads published gallery" on public.gallery_items for select
  using (published or public.is_admin());

create policy "admins write gallery" on public.gallery_items for insert
  with check (public.is_admin());
create policy "admins update gallery" on public.gallery_items for update
  using (public.is_admin());
create policy "admins delete gallery" on public.gallery_items for delete
  using (public.is_admin());
