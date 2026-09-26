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
