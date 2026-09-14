-- Page text an admin can rewrite from the page itself.
--
-- Every heading, blurb and label on the public pages ships in the bundle, so
-- changing a sentence meant editing source and redeploying. This holds
-- overrides by key ("home.archive.blurb"): the page renders the bundled text
-- first and swaps in whatever is saved here once it loads. No row means the
-- bundled text; deleting a row is "reset to default".
--
-- Same shape as team_members in 0012: anyone reads, only an admin writes.

create table if not exists public.site_copy (
  key        text        primary key check (char_length(key) between 1 and 200),
  value      text        not null check (char_length(value) <= 5000),
  updated_by uuid        references auth.users default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.site_copy enable row level security;

drop policy if exists "anyone reads site copy" on public.site_copy;
create policy "anyone reads site copy" on public.site_copy for select
  using (true);

drop policy if exists "admins write site copy" on public.site_copy;
create policy "admins write site copy" on public.site_copy for insert
  with check (public.is_admin());

drop policy if exists "admins update site copy" on public.site_copy;
create policy "admins update site copy" on public.site_copy for update
  using (public.is_admin());

drop policy if exists "admins delete site copy" on public.site_copy;
create policy "admins delete site copy" on public.site_copy for delete
  using (public.is_admin());
