-- Lets an admin send a verified guest back through the ID check.
--
-- "Verified" is a flag on profiles that apply_verification (0002) sets to
-- true when a check is approved, and nothing ever set back to false. There
-- was no way to say "do this again" - not for a card that turned out to be
-- somebody else's, not for a photo too dark to read, not for a guest whose
-- account changed hands.
--
-- Two things make a reset actually stick:
--
-- 1. profiles.verified goes false and birth_year clears, so checkout meets
--    the gate again. Done here as a security-definer function rather than a
--    policy: the only update policy on profiles is a guest's own, and a
--    blanket "admins update any profile" would grant far more than this one
--    field. is_admin() is checked inside.
--
-- 2. verification_reset_at is stamped, and the site reads it. A guest who
--    scanned their licence on their own phone also holds "verified" in that
--    phone's storage, and the site ORs the two so a scan clears the gate
--    before the database has heard about it. Without a timestamp the phone's
--    copy would win forever. With one, the site drops any local check older
--    than the reset - which is every check the reset was meant to undo, and
--    none of the ones done after it.
--
-- The approved rows themselves are marked rejected with a note rather than
-- deleted, so the roster still shows what was approved when and that it was
-- reset. apply_verification only fires on a transition to approved, so this
-- cannot re-approve anything on the way through.

alter table public.profiles
  add column if not exists verification_reset_at timestamptz;

create or replace function public.reset_verification(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = 'P0001';
  end if;

  update public.profiles
     set verified = false,
         birth_year = null,
         verification_reset_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'no such profile' using errcode = 'P0002';
  end if;

  update public.verifications
     set status = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         note = coalesce(nullif(note, ''), '') ||
                case when coalesce(note, '') = '' then '' else ' ' end ||
                'Reset by admin - resubmit required.'
   where user_id = p_user_id
     and status = 'approved';
end;
$$;

revoke all on function public.reset_verification(uuid) from public;
grant execute on function public.reset_verification(uuid) to authenticated;
