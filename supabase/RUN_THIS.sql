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
drop policy if exists "upload own id document" on storage.objects;
create policy "upload own id document" on storage.objects for insert
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Guests can see back what they sent, which is the difference between "we have
-- your ID" and "something was uploaded, we think".
drop policy if exists "read own id document" on storage.objects;
create policy "read own id document" on storage.objects for select
  using (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "admins read id documents" on storage.objects;
create policy "admins read id documents" on storage.objects for select
  using (bucket_id = 'id-documents' and public.is_admin());

drop policy if exists "admins delete id documents" on storage.objects;
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

drop policy if exists "anyone reads team" on public.team_members;
create policy "anyone reads team" on public.team_members for select
  using (true);

drop policy if exists "admins write team" on public.team_members;
create policy "admins write team" on public.team_members for insert
  with check (public.is_admin());
drop policy if exists "admins update team" on public.team_members;
create policy "admins update team" on public.team_members for update
  using (public.is_admin());
drop policy if exists "admins delete team" on public.team_members;
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
drop policy if exists "anyone reads published gallery" on public.gallery_items;
create policy "anyone reads published gallery" on public.gallery_items for select
  using (published or public.is_admin());

drop policy if exists "admins write gallery" on public.gallery_items;
create policy "admins write gallery" on public.gallery_items for insert
  with check (public.is_admin());
drop policy if exists "admins update gallery" on public.gallery_items;
create policy "admins update gallery" on public.gallery_items for update
  using (public.is_admin());
drop policy if exists "admins delete gallery" on public.gallery_items;
create policy "admins delete gallery" on public.gallery_items for delete
  using (public.is_admin());

-- ---------- 0013_verify_email_before_signup.sql ----------

-- Proves an email address before an account for it can exist, rather than
-- after.
--
-- Supabase's own "Confirm email" does the opposite of what that sounds like:
-- signUp() creates the auth.users row immediately, unconfirmed, and a click
-- on the emailed link only flips a column on that same row afterward. The
-- account exists the whole time it is "unconfirmed" - confirmation is a
-- status a row can be in, never a gate before the row exists. There is no
-- setting that changes this; it is how every Supabase project's email/
-- password auth works.
--
-- This is the piece that actually gates account creation: a one-time code,
-- sent to an address before anyone is asked for a password or anything else,
-- checked by public.handle_new_user() the moment an account is attempted.
-- If the code was never verified, the trigger raises, and Postgres rolls
-- back the whole insert - the row this migration is trying to prevent never
-- lands, not even for a moment. Two Edge Functions
-- (supabase/functions/request-signup-code, verify-signup-code) are what a
-- signed-out guest actually calls; nothing here is reachable by the anon or
-- authenticated roles at all, which is what makes "this address answered a
-- code we sent" a question only those functions can honestly answer.
--
-- Meant to replace Supabase's own post-signup confirmation, not sit beside
-- it - asking twice is worse than asking once. Turn "Confirm email" off
-- under Authentication -> Providers -> Email once this is deployed.

create table if not exists public.signup_codes (
  email       text primary key,
  code_hash   text        not null,
  attempts    int         not null default 0,
  verified_at timestamptz,
  -- What "still good" means, for whichever stage this row is in: 15 minutes
  -- to enter the code after it was sent, then - once verified - pushed out
  -- to 30 minutes from verification, so the rest of the form is not a race
  -- against a clock nobody can see.
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- RLS with no policies at all, the same lock admins (0001) uses: nothing
-- holding the anon or authenticated key may read this table, let alone
-- write to it. Every legitimate access goes through the two Edge Functions,
-- which hold the service role key and so answer to no policy here - that is
-- what makes them the only path in, rather than a convention everything
-- else has to remember to respect.
alter table public.signup_codes enable row level security;

-- ------------------------------------------------- the gate on signing up --

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
  clean_email text := lower(btrim(new.email));
  proven boolean;
begin
  select exists (
    select 1 from public.signup_codes
    where email = clean_email
      and verified_at is not null
      and expires_at > now()
  ) into proven;

  if not proven then
    raise exception 'Email not verified - request and enter a code before creating an account.'
      using errcode = 'P0001';
  end if;

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

  -- Consumed on success, so the same proof can never back a second account
  -- and a retried signup for the same address has to prove it again.
  delete from public.signup_codes where email = clean_email;

  return new;
end;
$$;

-- ---------- 0014_site_copy.sql ----------

-- Page text an admin can rewrite from the page itself.
--
-- Every heading, blurb and label on the public pages ships in the bundle, so
-- changing a sentence meant editing source and redeploying. This holds
-- overrides by key ("home.archive.blurb"): the page renders the bundled text
-- first and swaps in whatever is saved here once it loads. No row means the
-- bundled text; deleting a row is "reset to default".
--
-- Same shape as team_members in 0012: anyone reads, only an admin writes.

create table if not exists public.site_copy (
  key        text        primary key check (char_length(key) between 1 and 200),
  value      text        not null check (char_length(value) <= 5000),
  updated_by uuid        references auth.users default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.site_copy enable row level security;

drop policy if exists "anyone reads site copy" on public.site_copy;
create policy "anyone reads site copy" on public.site_copy for select
  using (true);

drop policy if exists "admins write site copy" on public.site_copy;
create policy "admins write site copy" on public.site_copy for insert
  with check (public.is_admin());

drop policy if exists "admins update site copy" on public.site_copy;
create policy "admins update site copy" on public.site_copy for update
  using (public.is_admin());

drop policy if exists "admins delete site copy" on public.site_copy;
create policy "admins delete site copy" on public.site_copy for delete
  using (public.is_admin());

-- ---------- 0015_raffle.sql ----------

-- A members' raffle: guests with a verified ID enter once, and anyone can see
-- who is in. "Verified" is the same bar as an RSVP - an admin approved their
-- ID (0002) - and it is the database, not the page, that holds entries to it.

-- ---------------------------------------------------------------- raffles --

create table if not exists public.raffles (
  id         text        primary key,
  title      text        not null,
  open       boolean     not null default true,
  created_at timestamptz not null default now()
);

alter table public.raffles enable row level security;

drop policy if exists "anyone reads raffles" on public.raffles;
create policy "anyone reads raffles" on public.raffles for select
  using (true);

drop policy if exists "admins write raffles" on public.raffles;
create policy "admins write raffles" on public.raffles for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.raffles (id, title)
values ('wctp-raffle-1', 'The WCTP Raffle')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- entries --

create table if not exists public.raffle_entries (
  raffle_id  text        not null references public.raffles on delete cascade,
  user_id    uuid        not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  -- One entry per person per raffle.
  primary key (raffle_id, user_id)
);

alter table public.raffle_entries enable row level security;

-- Whether the caller may enter: signed in and verified by an admin. No
-- argument on purpose, so it can't be used to ask about anyone else.
create or replace function public.raffle_eligible()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.verified
  );
$$;

drop policy if exists "read own raffle entries" on public.raffle_entries;
create policy "read own raffle entries" on public.raffle_entries for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "eligible members enter open raffles" on public.raffle_entries;
create policy "eligible members enter open raffles" on public.raffle_entries for insert
  with check (
    auth.uid() = user_id
    and public.raffle_eligible()
    and exists (select 1 from public.raffles r where r.id = raffle_id and r.open)
  );

drop policy if exists "admins remove raffle entries" on public.raffle_entries;
create policy "admins remove raffle entries" on public.raffle_entries for delete
  using (public.is_admin());

-- The public entry list. Instagram handles and entry times only - no names,
-- emails or ages leave profiles through this.
--
-- Dropped first, and not merely "or replace"d. 0017 further down this file
-- redefines this function with avatar_path added to its return table, and
-- CREATE OR REPLACE cannot change a function's return type - so on any project
-- where 0017 has already been applied, this statement failed with 42P13 and
-- took every statement after it down with it, including 0018 at the end.
drop function if exists public.raffle_entrants(text);
create function public.raffle_entrants(p_raffle text)
returns table (handle text, entered_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.instagram), ''), 'member') as handle,
         e.created_at as entered_at
  from public.raffle_entries e
  join public.profiles p on p.id = e.user_id
  where e.raffle_id = p_raffle
  order by e.created_at desc
  limit 1000;
$$;

revoke all on function public.raffle_entrants(text) from public;
grant execute on function public.raffle_entrants(text) to anon, authenticated;

-- ---------- 0016_raffle_admin_live.sql ----------

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

-- ---------- 0017_raffle_avatars_and_donor_board.sql ----------

-- Profile pictures on the raffle list, and a donor board fed by Stripe.
-- See supabase/migrations/0017_raffle_avatars_and_donor_board.sql for the why.

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

create table if not exists public.donations (
  id                uuid        primary key default gen_random_uuid(),
  stripe_session_id text        not null unique,
  user_id           uuid        references auth.users on delete set null,
  amount_cents      int         not null check (amount_cents > 0),
  show_on_board     boolean     not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists donations_user_idx on public.donations (user_id);

alter table public.donations enable row level security;

drop policy if exists "admins read donations" on public.donations;
create policy "admins read donations" on public.donations for select
  using (public.is_admin());

create or replace function public.donor_board()
returns table (
  handle       text,
  display_name text,
  avatar_path  text,
  total_cents  bigint,
  gifts        bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(p.instagram), ''),
         nullif(btrim(p.nickname), ''),
         p.avatar_path,
         sum(d.amount_cents)::bigint,
         count(*)::bigint
  from public.donations d
  join public.profiles p on p.id = d.user_id
  where d.show_on_board
  group by p.id, p.instagram, p.nickname, p.avatar_path
  order by sum(d.amount_cents) desc, min(d.created_at) asc
  limit 100;
$$;

revoke all on function public.donor_board() from public;
grant execute on function public.donor_board() to anon, authenticated;


-- ---------- 0018_ticket_redirect.sql ----------

-- Event photos and an outside ticket link.
--
-- See supabase/migrations/0018_ticket_redirect.sql for the why. Both columns
-- are nullable and both statements are safe to run twice.

alter table public.events
  add column if not exists ticket_redirect_url text;

-- Paths in the public site-images bucket, in the order they are shown. The
-- first is the flyer - what a listing card and a shared link preview use.
alter table public.events
  add column if not exists photo_paths text[] not null default '{}';

-- Five is a flyer plus four. Dropped first because ADD CONSTRAINT has no
-- IF NOT EXISTS and a re-run would otherwise fail here.
alter table public.events
  drop constraint if exists events_photo_paths_max;
alter table public.events
  add constraint events_photo_paths_max check (cardinality(photo_paths) <= 5);

-- The pictures live in the site-images bucket from 0012, which already lets an
-- admin write and anyone read. Nothing to add here - but if that migration was
-- never run, the bucket below is the whole of what the uploader needs.
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do update set public = true;

drop policy if exists "admins upload site images" on storage.objects;
create policy "admins upload site images" on storage.objects for insert
  with check (bucket_id = 'site-images' and public.is_admin());

drop policy if exists "admins replace site images" on storage.objects;
create policy "admins replace site images" on storage.objects for update
  using (bucket_id = 'site-images' and public.is_admin());

drop policy if exists "admins delete site images" on storage.objects;
create policy "admins delete site images" on storage.objects for delete
  using (bucket_id = 'site-images' and public.is_admin());

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

-- ---------- 0020_friends.sql ----------

-- Friends, found by Instagram handle.
--
-- A handle is already what an account is called here (see 0011), so there is
-- no new identity to invent - you add someone by the name they already go by.
--
-- Nothing in this file lets one guest read another's profile row. Profiles
-- stay locked to their owner; the two functions below are security definer and
-- hand back only a handle and a picture, which is what a friend list needs and
-- the whole of what it gets.

create table if not exists public.friendships (
  requester_id uuid        not null references auth.users on delete cascade,
  addressee_id uuid        not null references auth.users on delete cascade,
  status       text        not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,

  primary key (requester_id, addressee_id),
  constraint friendships_status  check (status in ('pending', 'accepted')),
  constraint friendships_no_self check (requester_id <> addressee_id)
);

-- One pair, one row, whichever way round it was asked.
--
-- Without this, A asks B, B asks A, and both sit pending forever with each
-- person looking at a request the other has already sent them.
create unique index if not exists friendships_pair
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

alter table public.friendships enable row level security;

drop policy if exists "read own friendships" on public.friendships;
create policy "read own friendships" on public.friendships for select
  using (auth.uid() in (requester_id, addressee_id) or public.is_admin());

drop policy if exists "send own friend request" on public.friendships;
create policy "send own friend request" on public.friendships for insert
  with check (auth.uid() = requester_id and status = 'pending');

-- Only the person who was asked can accept, and accepting is the only edit
-- there is. Without the WITH CHECK an addressee could update the row back to
-- pending, or a requester could mark their own request accepted.
drop policy if exists "accept a friend request" on public.friendships;
create policy "accept a friend request" on public.friendships for update
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status = 'accepted');

-- Either side can walk away, at any point. Declining and unfriending are the
-- same act as far as the table is concerned.
drop policy if exists "remove own friendship" on public.friendships;
create policy "remove own friendship" on public.friendships for delete
  using (auth.uid() in (requester_id, addressee_id) or public.is_admin());

-- ------------------------------------------------------------- finding one --

-- The handle an account goes by: its Instagram handle, or its name for an
-- account old enough not to have one.
create or replace function public.member_handle(p public.profiles)
returns text
language sql
immutable
as $$
  select nullif(btrim(coalesce(nullif(btrim(p.instagram), ''), p.name)), '');
$$;

/**
 * One member, by exact handle.
 *
 * Exact and case-insensitive, never a prefix or a LIKE: a partial match would
 * turn this into a way to walk the whole membership list one letter at a time.
 * A leading @ is tolerated because people paste handles with one.
 *
 * Security definer because profiles is readable only by its owner, and a
 * friend request has to be addressable to somebody you cannot otherwise see.
 * It returns an id, a handle and a picture - nothing that is not already on
 * the raffle wheel.
 */
create or replace function public.find_member(p_handle text)
returns table (id uuid, handle text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, public.member_handle(p), p.avatar_path
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and lower(public.member_handle(p)) = lower(btrim(ltrim(btrim(p_handle), '@')))
  limit 1;
$$;

revoke all on function public.find_member(text) from public;
grant execute on function public.find_member(text) to authenticated;

/**
 * This account's friends and outstanding requests, with the handle and picture
 * needed to draw them.
 *
 * `direction` says who asked, which is what decides whether a pending row
 * shows an Accept button or the word "sent".
 */
create or replace function public.my_friends()
returns table (
  user_id     uuid,
  handle      text,
  avatar_path text,
  status      text,
  direction   text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
    public.member_handle(p),
    p.avatar_path,
    f.status,
    case when f.requester_id = auth.uid() then 'sent' else 'received' end,
    f.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by f.status asc, f.created_at desc;
$$;

revoke all on function public.my_friends() from public;
grant execute on function public.my_friends() to authenticated;


-- ---------- 0021_xp.sql ----------

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


-- ---------- 0022_chat.sql ----------

-- The room.
--
-- One shared chat. Anyone signed in can read it; only an age-verified account
-- can post. That gate is not decoration - this site verifies age because
-- under-18s do sign up, and a room with image posting is the last place to let
-- an unreviewed account talk.
--
-- The site is a static export, so there is no server between a browser and
-- this table. Every rule below therefore has to be a policy, a constraint or a
-- trigger: anything enforced only in the React component is enforced only for
-- people who use the React component.

create table if not exists public.chat_messages (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users on delete cascade,
  body       text,
  -- Path in the chat-images bucket, for an uploaded picture.
  image_path text,
  -- A Giphy URL. Host-locked below for the same reason song request links are.
  gif_url    text,
  created_at timestamptz not null default now(),
  -- Set instead of deleting, so a moderator can see what was removed and by
  -- whom rather than the row simply vanishing from under an argument.
  hidden_at  timestamptz,
  hidden_by  uuid        references auth.users,

  constraint chat_body_len check (body is null or char_length(body) <= 600),
  -- A message has to be something. Without this, an empty row is a way to
  -- bump the room and push everything else up the screen.
  constraint chat_has_content check (
    coalesce(btrim(body), '') <> '' or image_path is not null or gif_url is not null
  ),
  constraint chat_gif_host check (
    gif_url is null
    or gif_url ~* '^https://([a-z0-9-]+\.)?(giphy\.com|giphy\.net)/'
  )
);

create index if not exists chat_messages_recent_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

-- Reading is for anyone with an account. Hidden messages are not served to
-- guests at all - a moderated message that still shows as "[removed]" is an
-- argument that carries on in the gaps.
drop policy if exists "members read the room" on public.chat_messages;
create policy "members read the room" on public.chat_messages for select
  using (
    auth.uid() is not null
    and (hidden_at is null or public.is_admin())
  );

-- Posting needs a verified account. profiles.verified is written only by the
-- review trigger in 0002, never by a client, so this cannot be self-granted.
drop policy if exists "verified members post" on public.chat_messages;
create policy "verified members post" on public.chat_messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.verified
    )
  );

-- Taking your own words back, or a moderator taking anyone's. This is the
-- update path and it may only ever hide.
drop policy if exists "hide a message" on public.chat_messages;
create policy "hide a message" on public.chat_messages for update
  using ((auth.uid() = user_id or public.is_admin()) and hidden_at is null)
  with check (hidden_at is not null);

drop policy if exists "admins delete messages" on public.chat_messages;
create policy "admins delete messages" on public.chat_messages for delete
  using (public.is_admin());

-- ------------------------------------------------------------ slowing down --

/**
 * Ten messages a minute, per person.
 *
 * Not an anti-spam system - it is a floor under one. A determined person with
 * the anon key and a loop can still post ten a minute forever, and the answer
 * to that is a moderator, not a trigger. What this stops is the accidental
 * version: a held key, a retry loop, a bored teenager with the console open.
 */
create or replace function public.limit_chat_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.chat_messages
   where user_id = new.user_id
     and created_at > now() - interval '1 minute';

  if recent >= 10 then
    raise exception 'Slow down a second.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists on_chat_message_insert on public.chat_messages;
create trigger on_chat_message_insert
  before insert on public.chat_messages
  for each row execute function public.limit_chat_rate();

-- --------------------------------------------------------------- the faces --

/**
 * Recent messages with the handle and picture to draw each one.
 *
 * A join to profiles would return nothing for other people's rows, since
 * profiles is readable only by its owner. Security definer, and it hands back
 * only what a chat line shows.
 */
create or replace function public.chat_recent(p_limit int default 100)
returns table (
  id          uuid,
  user_id     uuid,
  handle      text,
  avatar_path text,
  body        text,
  image_path  text,
  gif_url     text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.user_id, public.member_handle(p), p.avatar_path,
         m.body, m.image_path, m.gif_url, m.created_at
  from public.chat_messages m
  join public.profiles p on p.id = m.user_id
  where auth.uid() is not null
    and m.hidden_at is null
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.chat_recent(int) from public;
grant execute on function public.chat_recent(int) to authenticated;

-- --------------------------------------------------------------- pictures --

-- Its own bucket, not site-images: that one is admin-write (0012) and this is
-- the one place guests upload something everybody else sees.
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do update set public = true;

-- Verified accounts only, and only into a folder named for their own user id -
-- the same shape as the id-documents rule in 0002, so a path cannot be
-- forged to look like it came from somebody else.
drop policy if exists "verified members upload chat images" on storage.objects;
create policy "verified members upload chat images" on storage.objects for insert
  with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.verified)
  );

drop policy if exists "admins delete chat images" on storage.objects;
create policy "admins delete chat images" on storage.objects for delete
  using (bucket_id = 'chat-images' and public.is_admin());

-- Reading needs no policy: the bucket is public, which is what lets a message
-- render for everyone in the room.

-- ---------- 0023_stripe_tickets.sql ----------

-- Real money for tickets.
--
-- Until now the checkout was a mock: a read-only card field reading
-- 4242 4242 4242 4242 over the words "no card is charged". Orders were written
-- straight from the browser with whatever total the browser said, which was
-- harmless while nothing moved. It stops being harmless the moment Stripe is
-- connected, because the prices live in the JavaScript bundle and the insert
-- came from the same place - so a $250 table could be bought for $0 by anyone
-- willing to edit a request.
--
-- Two changes fix that, and neither is optional:
--
--   1. Prices move into this table, where the browser cannot reach them. The
--      edge function prices every order from here and tells Stripe the amount.
--   2. The browser may only ever insert a FREE order. Anything with a price is
--      inserted by the Stripe webhook, running as the service role, after
--      Stripe has confirmed the money arrived.
--
-- lib/tickets.ts keeps its copy for drawing the picker. It is a display cache
-- now, not the authority - and these rows were generated from it, so the two
-- start out identical.

-- ------------------------------------------------------------- the prices --

create table if not exists public.ticket_tiers (
  event_slug    text    not null,
  tier_id       text    not null,
  name          text    not null,
  price_cents   int     not null,
  capacity      int     not null default 0,
  sold          int     not null default 0,
  max_per_order int     not null default 6,
  admits        int     not null default 1,
  donation      boolean not null default false,
  min_cents     int,
  blurb         text,

  primary key (event_slug, tier_id),
  constraint ticket_tiers_price    check (price_cents >= 0),
  constraint ticket_tiers_capacity check (capacity >= 0 and sold >= 0)
);

alter table public.ticket_tiers enable row level security;

-- Anyone may read a price. They are already printed on the event page; what
-- matters is that nobody but an admin can write one.
drop policy if exists "anyone reads ticket tiers" on public.ticket_tiers;
create policy "anyone reads ticket tiers" on public.ticket_tiers for select
  using (true);

drop policy if exists "admins write ticket tiers" on public.ticket_tiers;
create policy "admins write ticket tiers" on public.ticket_tiers for all
  using (public.is_admin()) with check (public.is_admin());

-- Seeded from lib/tickets.ts as it stood when this was written. ON CONFLICT
-- DO NOTHING so re-running never overwrites a price edited since.
insert into public.ticket_tiers
  (event_slug, tier_id, name, price_cents, capacity, sold, max_per_order, admits, donation, min_cents, blurb)
values
('wecametoofurr', 'rsvp', 'Free RSVP', 0, 150, 73, 2, 1, false, null, 'Location is sent to you on the day of the event.'),
  ('wecametoofurr', 'donate', 'Donation', 0, 2147483647, 0, 1, 0, true, 100, 'Chip in for sound, lights and the next one. Any amount helps.'),
  ('saviis-21st-color-wave', 'rsvp', 'Free RSVP', 0, 100, 92, 2, 1, false, null, 'Dress code is colour. All of it.'),
  ('saviis-21st-color-wave', 'kit', 'RSVP + Colour Kit', 1200, 60, 21, 4, 1, false, null, 'Paint, chalk and a poncho waiting at the door.'),
  ('wecametooswag', 'rsvp', 'Free RSVP', 0, 200, 9, 4, 1, false, null, null),
  ('sniff-snort-pt-2', 'early', 'Early Bird', 1000, 50, 50, 4, 1, false, null, 'First fifty only.'),
  ('sniff-snort-pt-2', 'ga', 'General Admission', 1500, 150, 61, 6, 1, false, null, null),
  ('sniff-snort-pt-2', 'four', 'Group Of Four', 5000, 25, 4, 2, 4, false, null, 'One code, four heads through the door.'),
  ('wecametoocosplay', 'early', 'Early Bird', 1500, 60, 60, 4, 1, false, null, 'Gone.'),
  ('wecametoocosplay', 'ga', 'General Admission', 2000, 180, 44, 6, 1, false, null, null),
  ('wecametoocosplay', 'vip', 'VIP + Contest Entry', 3500, 40, 11, 4, 1, false, null, 'Early entry and a slot in the costume contest.'),
  ('wecametoohalloween', 'ga', 'General Admission', 2500, 300, 27, 6, 1, false, null, null),
  ('wecametoohalloween', 'vip', 'VIP', 4500, 60, 6, 4, 1, false, null, 'In from noon, private bar, own entrance.'),
  ('wecametoohalloween', 'table', 'Table For Six', 25000, 8, 1, 1, 6, false, null, 'Reserved table, bottle service, six wristbands.')
on conflict (event_slug, tier_id) do nothing;

-- ------------------------------------------------------- what was actually paid --

alter table public.orders
  add column if not exists paid_at           timestamptz,
  add column if not exists stripe_session_id text;

-- One order per Stripe session, so a webhook delivered twice - which Stripe
-- does, by design, and which is the single most common way a payment
-- integration double-charges or double-issues - cannot create a second order.
create unique index if not exists orders_stripe_session
  on public.orders (stripe_session_id)
  where stripe_session_id is not null;

create index if not exists orders_paid_idx on public.orders (paid_at);

-- ------------------------------------------------------------- the new rule --

-- The old policy let a signed-in guest insert any order at all. Replaced with
-- one that allows only a genuinely free one.
--
-- total_cents = 0 is the whole of it. A paid order arrives through the webhook
-- on the service role key, which bypasses row-level security entirely, so this
-- does not have to make an exception for it - and there is no exception here
-- for a client to find.
-- The live one is "insert own orders", plural - from 0001. Getting this
-- name wrong leaves the permissive policy in place and the rest of this
-- migration achieving nothing at all.
drop policy if exists "insert own orders" on public.orders;
drop policy if exists "insert own order" on public.orders;
drop policy if exists "create own order" on public.orders;
drop policy if exists "create own free order" on public.orders;
create policy "create own free order" on public.orders for insert
  with check (
    auth.uid() = user_id
    and coalesce(total_cents, 0) = 0
    and coalesce(subtotal_cents, 0) = 0
    -- Nothing may claim to have been paid except the webhook.
    and paid_at is null
    and stripe_session_id is null
  );

-- The same rule, one level down.
--
-- "insert own passes" in 0001 checks only that the order belongs to you. That
-- was fine when an order was already just a claim - but once orders are paid
-- for, it means somebody can buy one ticket and then staple another fifty
-- passes to their own settled order. Same for order_lines, which is what the
-- dashboard reads revenue and headcount off.
--
-- Both are now free-orders-only for a client. Every pass on a paid order is
-- written by the webhook on the service role key, which does not consult
-- these policies at all.

drop policy if exists "insert own passes" on public.passes;
create policy "insert own passes" on public.passes for insert
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
      and coalesce(o.total_cents, 0) = 0
      and o.stripe_session_id is null
  ));

drop policy if exists "insert own order lines" on public.order_lines;
create policy "insert own order lines" on public.order_lines for insert
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
      and coalesce(o.total_cents, 0) = 0
      and o.stripe_session_id is null
  ));

/**
 * Has this order been paid for?
 *
 * A free RSVP counts: nothing was owed and nothing is outstanding. This is
 * what the dashboard totals, so a started-but-abandoned checkout never shows
 * up as revenue.
 */
create or replace function public.order_is_settled(o public.orders)
returns boolean
language sql
immutable
as $$
  select o.cancelled_at is null
     and (o.paid_at is not null or coalesce(o.total_cents, 0) = 0);
$$;

-- ---------- 0024_chat_realtime.sql ----------

-- Make the lounge actually live.
--
-- 0022 created chat_messages and the browser subscribed to it, and nothing
-- ever arrived - messages only appeared on a refresh. The subscription was
-- fine. Postgres was simply never told to publish the table.
--
-- Supabase broadcasts row changes through a publication called
-- supabase_realtime, and a new table is not in it automatically. Until a table
-- is added, `postgres_changes` on it is a channel that connects, reports
-- SUBSCRIBED, and then stays silent forever - which is the most confusing
-- possible way for this to fail, because every visible sign says it worked.

-- The publication normally already exists on a Supabase project; created here
-- only so this file also works on a plain Postgres that has never had one.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ALTER PUBLICATION ... ADD TABLE errors if the table is already a member, and
-- there is no IF NOT EXISTS for it - so it is checked rather than guarded, to
-- keep this file safe to run twice like every other.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Hiding a message is an UPDATE, and an update's payload carries only the
-- changed columns unless the table publishes whole rows. Without this a
-- moderator's removal would reach other people's screens as a change they
-- cannot interpret - REPLICA IDENTITY FULL means the row arrives entire.
alter table public.chat_messages replica identity full;


-- ============================================================= 0025 --

-- The store: little prizes sold on the donate page, paid through Stripe, and
-- picked up at the next event by showing a QR to staff.
--
-- Two tables. store_products is what an admin puts on the shelf; anyone can
-- read what is on sale, only an admin writes. store_orders is who paid for
-- what - it has NO insert policy, so nothing holding the anon key or a guest's
-- session can create one. Rows arrive only from the edge functions, on the
-- service role, after Stripe has said the money is in (the same rule 0023 set
-- for paid ticket orders, for the same reason).
--
-- The claim code is the QR. It is random and long enough not to be guessed,
-- and it is only ever shown to the buyer (their own row) and to admins. The
-- handover is redeem_store_order(), which only an admin can call, and which
-- marks it in one statement so two staff scanning the same code at once can't
-- both hand a prize over.

-- ------------------------------------------------------------ products --

create table if not exists public.store_products (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (length(btrim(name)) between 1 and 80),
  blurb       text        not null default '',
  -- $1 to $1,000. A typo in the dashboard shouldn't be able to list a
  -- keychain at five figures.
  price_cents int         not null check (price_cents between 100 and 100000),
  -- A path in the public site-images bucket (0012), under store/.
  image_path  text,
  -- Null means no limit. Otherwise the checkout refuses once sold reaches it.
  stock       int         check (stock is null or stock >= 0),
  sold        int         not null default 0 check (sold >= 0),
  active      boolean     not null default true,
  sort        int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.store_products enable row level security;

drop policy if exists "anyone reads products on sale" on public.store_products;
create policy "anyone reads products on sale" on public.store_products for select
  using (active or public.is_admin());

drop policy if exists "admins add products" on public.store_products;
create policy "admins add products" on public.store_products for insert
  with check (public.is_admin());

drop policy if exists "admins edit products" on public.store_products;
create policy "admins edit products" on public.store_products for update
  using (public.is_admin());

drop policy if exists "admins delete products" on public.store_products;
create policy "admins delete products" on public.store_products for delete
  using (public.is_admin());

-- -------------------------------------------------------------- orders --

create table if not exists public.store_orders (
  id                uuid primary key default gen_random_uuid(),
  -- Kept when a product is deleted, so the record of a sale outlives the
  -- listing - the name and price are copied below for the same reason.
  product_id        uuid references public.store_products on delete set null,
  product_name      text        not null,
  qty               int         not null default 1 check (qty between 1 and 20),
  amount_cents      int         not null,
  user_id           uuid references auth.users on delete set null,
  buyer_name        text        not null default '',
  buyer_email       text        not null default '',
  buyer_phone       text,
  buyer_handle      text,
  stripe_session_id text        not null unique,
  stripe_invoice_id text,
  invoice_number    text,
  invoice_url       text,
  claim_code        text        not null unique,
  paid_at           timestamptz not null default now(),
  redeemed_at       timestamptz,
  redeemed_by       uuid references auth.users on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists store_orders_user_idx on public.store_orders (user_id);
create index if not exists store_orders_paid_idx on public.store_orders (paid_at desc);

alter table public.store_orders enable row level security;

drop policy if exists "buyers and admins read store orders" on public.store_orders;
create policy "buyers and admins read store orders" on public.store_orders for select
  using (auth.uid() = user_id or public.is_admin());

-- No insert policy, on purpose: see the note at the top.

-- ----------------------------------------------------------- handover --

-- Staff scan the QR, see who it is, and tap HAND OVER. Returns the order
-- whether or not this call was the one that marked it, plus `just_redeemed`,
-- so the screen can say "already handed over at 11:42" rather than a bare no.
create or replace function public.redeem_store_order(p_code text)
returns table (
  id            uuid,
  product_name  text,
  qty           int,
  buyer_name    text,
  buyer_handle  text,
  redeemed_at   timestamptz,
  just_redeemed boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  hit uuid;
begin
  if not public.is_admin() then
    raise exception 'Only staff can hand over prizes.';
  end if;

  update public.store_orders o
     set redeemed_at = now(), redeemed_by = auth.uid()
   where o.claim_code = p_code and o.redeemed_at is null
  returning o.id into hit;

  return query
    select o.id, o.product_name, o.qty, o.buyer_name, o.buyer_handle, o.redeemed_at,
           coalesce(o.id = hit, false) as just_redeemed
      from public.store_orders o
     where o.claim_code = p_code;
end;
$$;

revoke all on function public.redeem_store_order(text) from public;
grant execute on function public.redeem_store_order(text) to authenticated;

-- An admin undoing a handover tapped by mistake.
create or replace function public.unredeem_store_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only staff can change a handover.';
  end if;
  update public.store_orders set redeemed_at = null, redeemed_by = null where id = p_id;
end;
$$;

revoke all on function public.unredeem_store_order(uuid) from public;
grant execute on function public.unredeem_store_order(uuid) to authenticated;

-- The edge functions count a sale in one statement, so two payments landing
-- together can't both read the same `sold` and write the same +1.
create or replace function public.store_count_sale(p_product uuid, p_qty int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.store_products
     set sold = sold + greatest(p_qty, 0), updated_at = now()
   where id = p_product;
$$;

revoke all on function public.store_count_sale(uuid, int) from public, anon, authenticated;
grant execute on function public.store_count_sale(uuid, int) to service_role;
