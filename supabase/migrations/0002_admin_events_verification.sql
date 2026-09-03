-- Admin dashboard: events, the account list, and the ID verification queue.
--
-- Run after 0001_accounts.sql.

-- --------------------------------------------------- admins read the roster --

-- 0001 let a guest read only their own profile, which is right for a guest and
-- useless for a dashboard that has to list who signed up. Admins get a second,
-- separate policy rather than a loosened first one, so revoking the dashboard
-- never widens what a guest can see.
create policy "admins read all profiles" on public.profiles for select
  using (public.is_admin());

-- ------------------------------------------------------------------ events --

-- Events posted from the dashboard. lib/events.ts stays the source for the ones
-- already built into the site; these are additive and load at runtime.
create table if not exists public.events (
  slug        text primary key,
  title       text        not null,
  date        date        not null,
  time        text        not null default '9:00 PM',
  dow         text        not null default '',
  venue       text        not null default 'Location TBA',
  flyer_url   text,
  blurb       text,
  -- Drafts are invisible to guests; see the select policies below.
  published   boolean     not null default false,
  created_by  uuid        references auth.users,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists events_date_idx on public.events (date);

alter table public.events enable row level security;

-- Anyone, signed in or not, can read a published event - this is the public
-- listing. Drafts stay with the admins who wrote them.
create policy "anyone reads published events" on public.events for select
  using (published or public.is_admin());

create policy "admins write events"  on public.events for insert with check (public.is_admin());
create policy "admins update events" on public.events for update using      (public.is_admin());
create policy "admins delete events" on public.events for delete using      (public.is_admin());

-- ----------------------------------------------------------- verifications --

-- How the age check was attempted.
--   barcode  - PDF417 on the back of a driver's licence, parsed in the browser
--   document - a photo of something else (school or college ID), needs a human
do $$ begin
  create type public.verification_method as enum ('barcode', 'document');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.verifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users on delete cascade,
  method        public.verification_method not null,
  status        public.verification_status not null default 'pending',
  -- Only the year. A full date of birth is more than an 18+ door needs, and
  -- the less of it that is stored the less there is to leak.
  birth_year    int,
  -- Storage path in the private id-documents bucket. Null for barcode scans,
  -- which are parsed in the browser and never uploaded.
  document_path text,
  document_kind text,
  reviewed_by   uuid        references auth.users,
  reviewed_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists verifications_user_idx   on public.verifications (user_id);
create index if not exists verifications_status_idx on public.verifications (status);

alter table public.verifications enable row level security;

create policy "read own verifications" on public.verifications for select
  using (auth.uid() = user_id or public.is_admin());

create policy "submit own verification" on public.verifications for insert
  with check (auth.uid() = user_id);

-- Only an admin decides. A guest must not be able to move their own row to
-- 'approved', which is why there is no self-update policy here at all.
create policy "admins review verifications" on public.verifications for update
  using (public.is_admin());

-- Approving a verification is what flips the profile, so the two cannot drift
-- apart and no client is trusted to write `verified` itself.
create or replace function public.apply_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and coalesce(old.status, 'pending') is distinct from 'approved' then
    update public.profiles
       set verified = true,
           birth_year = coalesce(new.birth_year, birth_year)
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_verification_reviewed on public.verifications;
create trigger on_verification_reviewed
  after insert or update on public.verifications
  for each row execute function public.apply_verification();

-- -------------------------------------------------------- document storage --

-- Private. A photo of somebody's student ID is not something to serve from a
-- public URL, and this bucket is never made public.
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do nothing;

-- A guest uploads into a folder named after their own user id and cannot read
-- it back. Only admins can look, which is the point of the review queue.
create policy "upload own id document" on storage.objects for insert
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins read id documents" on storage.objects for select
  using (bucket_id = 'id-documents' and public.is_admin());

create policy "admins delete id documents" on storage.objects for delete
  using (bucket_id = 'id-documents' and public.is_admin());
