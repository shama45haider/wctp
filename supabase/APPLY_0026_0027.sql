-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Migration 0026: team categories an admin can add from the
-- Team page ("+ ADD A CATEGORY").
-- Migration 0027: events deleted from the home page stay gone,
-- including the ones bundled with the site.
--
-- Safe to run twice. Nothing to deploy afterwards.
-- =============================================================

-- Team categories an admin can add from the roster page itself.
--
-- The six sections on /team (CEOs, DJs, Artists, ...) are fixed in
-- lib/artists.ts, so a new kind of crew meant editing source and redeploying.
-- This table holds the extra ones, drawn after the bundled six in `sort`
-- order. team_members.role is already free text, so a card files itself under
-- a new section just by naming its id.

create table if not exists public.team_sections (
  -- The slug a card's role points at and the page anchors on (#<id>s).
  id          text        primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  heading     text        not null,
  label       text        not null,
  blurb       text,
  -- A CSS hex colour for the section's accent.
  accent      text        not null default '#ff5fa8' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  sort        int         not null default 0,
  created_by  uuid        references auth.users default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.team_sections enable row level security;

drop policy if exists "anyone reads team sections" on public.team_sections;
create policy "anyone reads team sections" on public.team_sections for select
  using (true);

drop policy if exists "admins write team sections" on public.team_sections;
create policy "admins write team sections" on public.team_sections for insert
  with check (public.is_admin());
drop policy if exists "admins update team sections" on public.team_sections;
create policy "admins update team sections" on public.team_sections for update
  using (public.is_admin());
drop policy if exists "admins delete team sections" on public.team_sections;
create policy "admins delete team sections" on public.team_sections for delete
  using (public.is_admin());

-- Events an admin deleted from the home page.
--
-- Deleting the row in public.events is not enough on its own: most dates are
-- also compiled into the bundle from lib/events.ts, and the site lays the
-- database over that list rather than replacing it, so a bundled date would
-- come straight back. A slug listed here is dropped from every list on the
-- site, bundled or not. Saving the date again from /admin/events clears it.
--
-- Readable by anyone, because a guest's browser is the one that has to leave
-- the date out. Only an admin writes.

create table if not exists public.event_removals (
  slug        text        primary key,
  removed_by  uuid        references auth.users default auth.uid(),
  removed_at  timestamptz not null default now()
);

alter table public.event_removals enable row level security;

drop policy if exists "anyone reads event removals" on public.event_removals;
create policy "anyone reads event removals" on public.event_removals for select
  using (true);

drop policy if exists "admins write event removals" on public.event_removals;
create policy "admins write event removals" on public.event_removals for insert
  with check (public.is_admin());
drop policy if exists "admins update event removals" on public.event_removals;
create policy "admins update event removals" on public.event_removals for update
  using (public.is_admin());
drop policy if exists "admins delete event removals" on public.event_removals;
create policy "admins delete event removals" on public.event_removals for delete
  using (public.is_admin());
