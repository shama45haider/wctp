-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Migration 0031: a picture for each ticket add-on, uploaded in
-- the Add-ons section at the bottom of /admin/events and shown on
-- the add-on tiles in the ticket picker.
--
-- Safe to run twice. Until it runs, add-ons still sell - they
-- just show a letter instead of a picture, and the admin editor
-- cannot save.
-- =============================================================

alter table public.ticket_addons
  add column if not exists image_path text;

-- One row: whether the column is there now.
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'ticket_addons' and column_name = 'image_path'
) as addon_images_ready;
