-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Everything outstanding, in order, in one paste. Every
-- statement is safe to run twice, so it does not matter if
-- part of it has been applied before.
-- =============================================================

-- ---------- 0003_storage_fix.sql ----------

-- Creates the private ID-document bucket and its policies.
--
-- Split out of 0002 because that migration's storage section did not take: the
-- tables landed but the bucket did not exist afterwards. Creating policies on
-- storage.objects needs rights the SQL editor does not always hold, and when
-- that statement fails it takes the rest of the script down with it - quietly,
-- because the tables before it had already committed.
--
-- So run this on its own. Every statement is safe to run twice, and if the
-- policy block still fails on permissions the bucket above it will already
-- exist, and the four policies can be added from Storage -> Policies instead.

-- ------------------------------------------------------------- the bucket --

-- Private. A photo of somebody's student ID is not something to serve from a
-- public URL; the dashboard reads these through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do update set public = false;

-- ----------------------------------------------------------- the policies --

-- Dropped first rather than guarded, because CREATE POLICY has no IF NOT
-- EXISTS and a re-run would otherwise fail on the first one and skip the rest.
drop policy if exists "upload own id document"  on storage.objects;
drop policy if exists "admins read id documents" on storage.objects;
drop policy if exists "admins delete id documents" on storage.objects;
drop policy if exists "read own id document" on storage.objects;

-- A guest may only write into a folder named for their own user id. This is
-- what makes the upload path in IdDocumentUpload load-bearing rather than
-- cosmetic: a file placed anywhere else is rejected by the database.
create policy "upload own id document" on storage.objects for insert
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Guests can see back what they sent, which is the difference between "we have
-- your ID" and "something was uploaded, we think".
create policy "read own id document" on storage.objects for select
  using (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins read id documents" on storage.objects for select
  using (bucket_id = 'id-documents' and public.is_admin());

create policy "admins delete id documents" on storage.objects for delete
  using (bucket_id = 'id-documents' and public.is_admin());

-- ---------- 0004_order_line_donation.sql ----------

-- order_lines lacked a way to say a line was a donation, so writing a real
-- order to the database would have silently dropped that distinction and the
-- account page would show a gift as a ticket tier called "donate". Additive
-- and safe to run twice.

alter table public.order_lines
  add column if not exists donation boolean not null default false;

-- ---------- 0005_barcode_verification.sql ----------

-- A sanctioned way to record a barcode-verified guest, and a lock on every
-- other way.
--
-- 0002 states the rule in a comment - "only an admin decides. A guest must not
-- be able to move their own row to 'approved'" - and then only enforces it for
-- UPDATE. The insert policy checked auth.uid() = user_id and nothing else, so a
-- guest could file their own row at status 'approved' directly and the
-- apply_verification trigger, which fires on INSERT as well as UPDATE, would
-- flip profiles.verified for them on the spot with whatever birth year they
-- felt like sending. Nothing in the app ever did that - IdDocumentUpload always
-- writes 'pending' - but the API is the boundary, not the app.

-- ------------------------------------------------------- direct inserts --

-- Pending, always. This is the whole table's front door, and nothing coming
-- through it decides its own outcome.
drop policy if exists "submit own verification" on public.verifications;
create policy "submit own verification" on public.verifications for insert
  with check (auth.uid() = user_id and status = 'pending');

-- ------------------------------------------------------ the one exception --

-- A licence whose barcode has already been read and parsed proves a date of
-- birth on its own, which is the entire reason for scanning it - making that
-- guest wait on a human to agree would be theatre. So this is allowed to
-- approve, and it is a function rather than a policy exemption because the
-- function is what makes it narrow: status and method are written here, in
-- code the caller does not get to influence, so invoking this can never mean
-- anything except "a barcode was read". A raw insert still cannot say either.
--
-- SECURITY DEFINER runs the insert as the owner, past the policy above.
-- auth.uid() is unaffected by that and still identifies the caller, so this
-- can only ever file a row against whoever is actually signed in.
create or replace function public.record_barcode_verification(
  p_birth_year int,
  p_document_path text default null,
  p_document_kind text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.verifications (
    user_id, method, status, birth_year, document_path, document_kind, note
  )
  values (
    auth.uid(),
    'barcode',
    'approved',
    p_birth_year,
    p_document_path,
    p_document_kind,
    'Barcode read and parsed in the guest''s own browser. Approved without a human reading it - the photo is on file for the door, not because anyone checked it.'
  );
end;
$$;

revoke all on function public.record_barcode_verification(int, text, text) from public;
grant execute on function public.record_barcode_verification(int, text, text) to authenticated;

-- ---------- 0006_profile_editing.sql ----------

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

-- ---------- 0007_signup_metadata.sql ----------

-- Carries the rest of the sign-up answers onto the profile row.
--
-- handle_new_user already copied `name` out of the sign-up metadata, which is
-- what makes it survive email confirmation: the trigger fires when the auth
-- user is created, long before there is a session to write a profile with. The
-- sign-up wizard also asks for a phone number and can offer a nickname, and
-- without this those would sit in raw_user_meta_data forever while the columns
-- meant for them stayed empty.
--
-- Depends on 0006 for the nickname column. Run them in order.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, phone, nickname)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'nickname', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

