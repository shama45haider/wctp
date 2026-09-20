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
