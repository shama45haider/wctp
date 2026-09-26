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
