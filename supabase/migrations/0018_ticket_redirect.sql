-- Add ticket redirect URL to events table
-- Allows events to redirect to an external ticketing page instead of showing RSVP

alter table public.events
add column if not exists ticket_redirect_url text;

-- Existing events without a redirect keep showing the normal ticket picker (null = normal behavior)
