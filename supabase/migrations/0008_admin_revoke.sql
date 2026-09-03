-- Lets an admin take a ticket back.
--
-- "cancel own orders" in 0001 is auth.uid() = user_id and nothing else, which
-- is right for a guest and leaves an admin unable to revoke anyone's order at
-- all - the only update policy on orders was a guest's own. A door needs the
-- reverse: to void what somebody else holds.
--
-- Two grains. Cancelling an order voids everything on it, which is a refund or
-- a no-show. Revoking one pass leaves the rest of the party's tickets standing,
-- which is the case where one person out of four is the problem. passes had no
-- way to say the second thing - used_at means scanned in, the opposite of
-- turned away - so revoked_at is new.

alter table public.passes
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users;

drop policy if exists "admins cancel any order" on public.orders;
create policy "admins cancel any order" on public.orders for update
  using (public.is_admin());

-- The existing "admin marks passes used" policy already grants update on
-- passes to admins, so revoked_at needs no policy of its own.
