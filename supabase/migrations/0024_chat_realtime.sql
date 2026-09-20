-- Make the lounge actually live.
--
-- 0022 created chat_messages and the browser subscribed to it, and nothing
-- ever arrived - messages only appeared on a refresh. The subscription was
-- fine. Postgres was simply never told to publish the table.
--
-- Supabase broadcasts row changes through a publication called
-- supabase_realtime, and a new table is not in it automatically. Until a table
-- is added, `postgres_changes` on it is a channel that connects, reports
-- SUBSCRIBED, and then stays silent forever - which is the most confusing
-- possible way for this to fail, because every visible sign says it worked.

-- The publication normally already exists on a Supabase project; created here
-- only so this file also works on a plain Postgres that has never had one.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ALTER PUBLICATION ... ADD TABLE errors if the table is already a member, and
-- there is no IF NOT EXISTS for it - so it is checked rather than guarded, to
-- keep this file safe to run twice like every other.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Hiding a message is an UPDATE, and an update's payload carries only the
-- changed columns unless the table publishes whole rows. Without this a
-- moderator's removal would reach other people's screens as a change they
-- cannot interpret - REPLICA IDENTITY FULL means the row arrives entire.
alter table public.chat_messages replica identity full;
