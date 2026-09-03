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
