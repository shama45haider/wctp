-- A picture for each add-on, shown on its tile in the ticket picker.
--
-- Stored as a path inside the site-images bucket, the same bucket as team and
-- event photos, so the public URL is worked out where it is shown. Admins
-- already write ticket_addons (0028) and anyone can read it, so no new policy
-- is needed.

alter table public.ticket_addons
  add column if not exists image_path text;
