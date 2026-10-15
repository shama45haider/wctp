-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- What is outstanding from 2026-10-14, and nothing else:
--   0031  a picture column for ticket add-ons
--   0032  lets first-time Google / Apple sign-ins create an account
--
-- Safe to run twice. The last statement prints one row saying
-- whether each change landed.
-- =============================================================

-- ---------- 0031: add-on pictures ----------

alter table public.ticket_addons
  add column if not exists image_path text;

-- ---------- 0032: Google and Apple sign-up ----------

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

-- ---------- did it land? ----------

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ticket_addons' and column_name = 'image_path'
  ) as addon_images_ready,
  (select prosrc like '%''google'', ''apple''%' from pg_proc where proname = 'handle_new_user') as oauth_signup_ready;
