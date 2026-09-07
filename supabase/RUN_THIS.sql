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

-- ---------- 0008_admin_revoke.sql ----------

-- Lets an admin take a ticket back.
--
-- "cancel own orders" in 0001 is auth.uid() = user_id and nothing else, which
-- is right for a guest and leaves an admin unable to revoke anyone's order at
-- all - the only update policy on orders was a guest's own. A door needs the
-- reverse: to void what somebody else holds.
--
-- Two grains. Cancelling an order voids everything on it, which is a refund or
-- a no-show. Revoking one pass leaves the rest of the party's tickets standing,
-- which is the case where one person out of four is the problem. passes had no
-- way to say the second thing - used_at means scanned in, the opposite of
-- turned away - so revoked_at is new.

alter table public.passes
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users;

drop policy if exists "admins cancel any order" on public.orders;
create policy "admins cancel any order" on public.orders for update
  using (public.is_admin());

-- The existing "admin marks passes used" policy already grants update on
-- passes to admins, so revoked_at needs no policy of its own.

-- ---------- 0009_admin_mastertripsitter.sql ----------

-- Makes mastertripsitter@gmail.com an admin.
--
-- The admins table has no insert policy on purpose - nothing holding the
-- public key can add itself to it - so the SQL editor, which runs as
-- service_role and bypasses row-level security, is the one way in.
--
-- The account has to exist first. This looks the address up in auth.users,
-- and if that person has not signed up yet there is nothing to point at, so it
-- says so rather than inserting nothing quietly. Safe to run twice: a second
-- run finds the row already there and leaves it.

do $$
declare
  uid uuid;
begin
  select id into uid
  from auth.users
  where lower(email) = 'mastertripsitter@gmail.com'
  limit 1;

  if uid is null then
    raise warning 'No account for mastertripsitter@gmail.com yet. Have them sign up on the site first, then run this again.';
    return;
  end if;

  insert into public.admins (user_id)
  values (uid)
  on conflict (user_id) do nothing;

  raise notice 'mastertripsitter@gmail.com is an admin.';
end $$;

-- ---------- 0010_reset_verification.sql ----------

-- Lets an admin send a verified guest back through the ID check.
--
-- "Verified" is a flag on profiles that apply_verification (0002) sets to
-- true when a check is approved, and nothing ever set back to false. There
-- was no way to say "do this again" - not for a card that turned out to be
-- somebody else's, not for a photo too dark to read, not for a guest whose
-- account changed hands.
--
-- Two things make a reset actually stick:
--
-- 1. profiles.verified goes false and birth_year clears, so checkout meets
--    the gate again. Done here as a security-definer function rather than a
--    policy: the only update policy on profiles is a guest's own, and a
--    blanket "admins update any profile" would grant far more than this one
--    field. is_admin() is checked inside.
--
-- 2. verification_reset_at is stamped, and the site reads it. A guest who
--    scanned their licence on their own phone also holds "verified" in that
--    phone's storage, and the site ORs the two so a scan clears the gate
--    before the database has heard about it. Without a timestamp the phone's
--    copy would win forever. With one, the site drops any local check older
--    than the reset - which is every check the reset was meant to undo, and
--    none of the ones done after it.
--
-- The approved rows themselves are marked rejected with a note rather than
-- deleted, so the roster still shows what was approved when and that it was
-- reset. apply_verification only fires on a transition to approved, so this
-- cannot re-approve anything on the way through.

alter table public.profiles
  add column if not exists verification_reset_at timestamptz;

create or replace function public.reset_verification(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = 'P0001';
  end if;

  update public.profiles
     set verified = false,
         birth_year = null,
         verification_reset_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'no such profile' using errcode = 'P0002';
  end if;

  update public.verifications
     set status = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         note = coalesce(nullif(note, ''), '') ||
                case when coalesce(note, '') = '' then '' else ' ' end ||
                'Reset by admin - resubmit required.'
   where user_id = p_user_id
     and status = 'approved';
end;
$$;

revoke all on function public.reset_verification(uuid) from public;
grant execute on function public.reset_verification(uuid) to authenticated;

-- ---------- 0011_age_check_rework.sql ----------

-- Age check rework: manual review only, Instagram-named accounts, and a lock
-- on the columns that only a review may set.
--
-- Three things, each safe to run twice.
--
-- 1. No more self-approval. record_barcode_verification (0005) let a signed-in
--    guest file an 'approved' row from a barcode their own browser had read.
--    Every check is now read by a person, so that route is dropped outright.
--    From here on the only way a verifications row reaches 'approved' is an
--    admin updating it ("admins review verifications", 0002), and the only
--    way profiles.verified turns true is the trigger that follows from that.
--
-- 2. The account is its Instagram handle. Sign-up asks for a first name, an
--    age, an Instagram handle, an email and an optional phone number, and the
--    handle is what the account is called - on the profile, on the ticket, on
--    the roster. first_name and age are new columns; name is set to the handle
--    by handle_new_user. Existing accounts keep the name they have until they
--    add a handle on /profile, which writes both.
--
-- 3. verified, birth_year and verification_reset_at can no longer be written
--    by the guest. "update own profile" (0001) allows the whole row, which
--    meant a guest could PATCH verified=true through the API and skip the
--    review entirely - the app never did, but the API is the boundary. A
--    trigger now refuses that from the API roles unless the caller is an
--    admin. The security-definer functions that legitimately set these
--    (apply_verification, reset_verification) run as the table owner and are
--    not gated, which is what lets an approval land.

-- ------------------------------------------------------ new profile columns --

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists age        int;

-- --------------------------------------------------- sign-up into the profile --

-- Reads the sign-up answers out of the auth user's metadata. Fires on the auth
-- row, not on a session, so these survive email confirmation - there is no
-- signed-in moment afterwards in which to write them.
--
-- The handle is normalised here as well as in the app: whitespace and a
-- leading @ stripped, lowercased. Instagram treats case as decoration, and two
-- spellings of one handle must land on one account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text := nullif(
    lower(ltrim(btrim(coalesce(new.raw_user_meta_data ->> 'instagram', '')), '@')),
    ''
  );
  stated_age text := btrim(coalesce(new.raw_user_meta_data ->> 'age', ''));
begin
  insert into public.profiles (id, email, name, first_name, age, instagram, phone, nickname)
  values (
    new.id,
    new.email,
    coalesce(
      handle,
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
      split_part(new.email, '@', 1)
    ),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), ''),
    case when stated_age ~ '^\d{1,3}$' then stated_age::int else null end,
    handle,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ------------------------------------------------ the barcode route, closed --

drop function if exists public.record_barcode_verification(int, text, text);

-- Dropping the function closes the one door it opened, but not the front
-- door it stood beside: "submit own verification" (0005) checks only
-- auth.uid() = user_id and status = 'pending', and never looked at method.
-- Nothing stopped a guest from posting a 'pending' row with method='barcode'
-- and no document_path straight to PostgREST - no IdDocumentUpload, no photo,
-- no redaction - and having it land in the admin queue looking exactly like
-- a real submission. From here every new check a guest can file is a
-- document; 'barcode' stays a valid value only so the rows old approvals
-- left behind keep meaning what they always meant.
drop policy if exists "submit own verification" on public.verifications;
create policy "submit own verification" on public.verifications for insert
  with check (auth.uid() = user_id and status = 'pending' and method = 'document');

-- ---------------------------------------------- review columns, guests out --

-- SECURITY INVOKER on purpose, unlike almost everything else in these files.
-- The check reads current_user, and a definer function would always see its
-- owner there. As an invoker it sees the role the request came in as:
-- 'authenticated' or 'anon' for anything holding the public key, and the
-- table owner for the definer functions that set these columns legitimately.
create or replace function public.guard_profile_review_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verified
       or new.birth_year is not null
       or new.verification_reset_at is not null then
      raise exception 'verified, birth_year and verification_reset_at are set by an age review, not by the guest'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.verified is distinct from old.verified
     or new.birth_year is distinct from old.birth_year
     or new.verification_reset_at is distinct from old.verification_reset_at then
    raise exception 'verified, birth_year and verification_reset_at are set by an age review, not by the guest'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_review_columns on public.profiles;
create trigger guard_profile_review_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_review_columns();

-- ------------------------------------------------------------- the venue --

-- Not dropped, so nothing already stored is lost, but the site no longer
-- reads or writes it: where a night happens goes out by email to the list,
-- never onto the page.
comment on column public.events.venue is
  'Unused since 0011. The address is emailed to the list and never shown on the site.';

-- ---------- 0012_team_and_gallery.sql ----------

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
