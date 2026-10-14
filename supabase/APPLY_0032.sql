-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Migration 0032: lets a first-time Google or Apple sign-in create
-- an account. Until it runs, those buttons come back with "Google
-- and Apple sign-up isn't switched on yet" for anyone new; people
-- who already have an account with the same email still get in.
--
-- Safe to run twice. Run it after turning the providers on under
-- Authentication -> Sign In / Providers.
-- =============================================================

-- Google and Apple sign-in.
--
-- handle_new_user (0013) refuses any new account whose email has not answered
-- a code from request-signup-code. That is the right gate for email and
-- password, but a Google or Apple account never goes through that form: the
-- provider has already proven it owns the address, and its users arrive at
-- this trigger with no code on file. Without this, every first-time Google or
-- Apple sign-in would fail with "Database error saving new user".
--
-- So the code is still required for everything except those two providers,
-- whose name is in raw_app_meta_data.provider. Their profile name falls back to
-- the provider's full name, and the first name to its given name; the
-- Instagram handle is asked for afterwards on /profile.
--
-- Same signature as before (returns trigger), so CREATE OR REPLACE is safe.

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
  clean_email text := lower(btrim(coalesce(new.email, '')));
  via text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  full_name text := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), '');
  proven boolean;
begin
  if via in ('google', 'apple') then
    proven := true;
  else
    select exists (
      select 1 from public.signup_codes
      where email = clean_email
        and verified_at is not null
        and expires_at > now()
    ) into proven;
  end if;

  if not proven then
    raise exception 'Email not verified - request and enter a code before creating an account.'
      using errcode = 'P0001';
  end if;

  insert into public.profiles (id, email, name, first_name, age, instagram, phone, nickname)
  values (
    new.id,
    new.email,
    coalesce(handle, full_name, nullif(split_part(clean_email, '@', 1), ''), 'member'),
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'given_name', '')), ''),
      nullif(split_part(coalesce(full_name, ''), ' ', 1), '')
    ),
    case when stated_age ~ '^\d{1,3}$' then stated_age::int else null end,
    handle,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '')
  )
  on conflict (id) do nothing;

  -- Consumed on success, so the same proof can never back a second account.
  delete from public.signup_codes where email = clean_email;

  return new;
end;
$$;

-- One row: true once the new version of the trigger is in place.
select prosrc like '%''google'', ''apple''%' as oauth_signup_ready
from pg_proc where proname = 'handle_new_user';
