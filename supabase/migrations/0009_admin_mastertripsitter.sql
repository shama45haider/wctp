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
