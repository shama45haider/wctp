-- Lets someone with an account set a nickname and a picture.
--
-- `name` already exists and is written by the ID check from what the licence
-- says, so it is the legal name and not something a guest should be editing.
-- `nickname` is the one they choose and the one the site shows; the two are
-- kept apart on purpose, because a door comparing a card against a screen
-- needs the name off the card to still be there underneath.

alter table public.profiles
  add column if not exists nickname    text,
  add column if not exists avatar_path text;

-- --------------------------------------------------------------- avatars --

-- Public, unlike id-documents. A profile picture is meant to be looked at, and
-- serving it through a signed link that dies after a minute would mean
-- re-fetching one every time the page renders. The trade is real and worth
-- naming: anyone holding the URL can open it, so this bucket must never be
-- used for anything a guest would not put on a public profile.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Writes stay own-folder only, exactly like id-documents: the first path
-- segment has to be the uploader's own id or the write is refused, so nobody
-- can overwrite somebody else's picture.
drop policy if exists "upload own avatar" on storage.objects;
create policy "upload own avatar" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "replace own avatar" on storage.objects;
create policy "replace own avatar" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "remove own avatar" on storage.objects;
create policy "remove own avatar" on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reading needs no policy: the bucket is public, which is the whole point.
