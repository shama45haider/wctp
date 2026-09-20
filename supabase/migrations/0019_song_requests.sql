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
