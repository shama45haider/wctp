-- A sanctioned way to record a barcode-verified guest, and a lock on every
-- other way.
--
-- 0002 states the rule in a comment - "only an admin decides. A guest must not
-- be able to move their own row to 'approved'" - and then only enforces it for
-- UPDATE. The insert policy checked auth.uid() = user_id and nothing else, so a
-- guest could file their own row at status 'approved' directly and the
-- apply_verification trigger, which fires on INSERT as well as UPDATE, would
-- flip profiles.verified for them on the spot with whatever birth year they
-- felt like sending. Nothing in the app ever did that - IdDocumentUpload always
-- writes 'pending' - but the API is the boundary, not the app.

-- ------------------------------------------------------- direct inserts --

-- Pending, always. This is the whole table's front door, and nothing coming
-- through it decides its own outcome.
drop policy if exists "submit own verification" on public.verifications;
create policy "submit own verification" on public.verifications for insert
  with check (auth.uid() = user_id and status = 'pending');

-- ------------------------------------------------------ the one exception --

-- A licence whose barcode has already been read and parsed proves a date of
-- birth on its own, which is the entire reason for scanning it - making that
-- guest wait on a human to agree would be theatre. So this is allowed to
-- approve, and it is a function rather than a policy exemption because the
-- function is what makes it narrow: status and method are written here, in
-- code the caller does not get to influence, so invoking this can never mean
-- anything except "a barcode was read". A raw insert still cannot say either.
--
-- SECURITY DEFINER runs the insert as the owner, past the policy above.
-- auth.uid() is unaffected by that and still identifies the caller, so this
-- can only ever file a row against whoever is actually signed in.
create or replace function public.record_barcode_verification(
  p_birth_year int,
  p_document_path text default null,
  p_document_kind text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.verifications (
    user_id, method, status, birth_year, document_path, document_kind, note
  )
  values (
    auth.uid(),
    'barcode',
    'approved',
    p_birth_year,
    p_document_path,
    p_document_kind,
    'Barcode read and parsed in the guest''s own browser. Approved without a human reading it - the photo is on file for the door, not because anyone checked it.'
  );
end;
$$;

revoke all on function public.record_barcode_verification(int, text, text) from public;
grant execute on function public.record_barcode_verification(int, text, text) to authenticated;
