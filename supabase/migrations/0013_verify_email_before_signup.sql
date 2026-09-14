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
