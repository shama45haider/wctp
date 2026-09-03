-- order_lines lacked a way to say a line was a donation, so writing a real
-- order to the database would have silently dropped that distinction and the
-- account page would show a gift as a ticket tier called "donate". Additive
-- and safe to run twice.

alter table public.order_lines
  add column if not exists donation boolean not null default false;
