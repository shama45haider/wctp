-- Creates the private ID-document bucket and its policies.
--
-- Split out of 0002 because that migration's storage section did not take: the
-- tables landed but the bucket did not exist afterwards. Creating policies on
-- storage.objects needs rights the SQL editor does not always hold, and when
-- that statement fails it takes the rest of the script down with it - quietly,
-- because the tables before it had already committed.
--
-- So run this on its own. Every statement is safe to run twice, and if the
-- policy block still fails on permissions the bucket above it will already
-- exist, and the four policies can be added from Storage -> Policies instead.

-- ------------------------------------------------------------- the bucket --

-- Private. A photo of somebody's student ID is not something to serve from a
-- public URL; the dashboard reads these through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do update set public = false;

-- ----------------------------------------------------------- the policies --

-- Dropped first rather than guarded, because CREATE POLICY has no IF NOT
-- EXISTS and a re-run would otherwise fail on the first one and skip the rest.
drop policy if exists "upload own id document"  on storage.objects;
drop policy if exists "admins read id documents" on storage.objects;
drop policy if exists "admins delete id documents" on storage.objects;
drop policy if exists "read own id document" on storage.objects;

-- A guest may only write into a folder named for their own user id. This is
-- what makes the upload path in IdDocumentUpload load-bearing rather than
-- cosmetic: a file placed anywhere else is rejected by the database.
create policy "upload own id document" on storage.objects for insert
  with check (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Guests can see back what they sent, which is the difference between "we have
-- your ID" and "something was uploaded, we think".
create policy "read own id document" on storage.objects for select
  using (
    bucket_id = 'id-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins read id documents" on storage.objects for select
  using (bucket_id = 'id-documents' and public.is_admin());

create policy "admins delete id documents" on storage.objects for delete
  using (bucket_id = 'id-documents' and public.is_admin());
