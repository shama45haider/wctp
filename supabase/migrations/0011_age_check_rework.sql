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
