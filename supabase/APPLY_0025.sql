-- =============================================================
-- RUN THIS WHOLE FILE IN THE SUPABASE SQL EDITOR.
--
-- Migration 0025: the store - prizes sold on the donate page,
-- paid through Stripe, picked up at the next event with a QR.
--
-- Safe to run twice. After running it, deploy the two new edge
-- functions and redeploy the webhook (it now also records store
-- purchases):
--
--   npx supabase functions deploy create-store-checkout --use-api
--   npx supabase functions deploy store-order-status --use-api
--   npx supabase functions deploy stripe-ticket-webhook --no-verify-jwt --use-api
--
-- They use the STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET that
-- are already set for tickets. Nothing to add in Stripe: the
-- existing webhook endpoint already hears checkout.session.completed.
-- =============================================================

-- The store: little prizes sold on the donate page, paid through Stripe, and
-- picked up at the next event by showing a QR to staff.
--
-- Two tables. store_products is what an admin puts on the shelf; anyone can
-- read what is on sale, only an admin writes. store_orders is who paid for
-- what - it has NO insert policy, so nothing holding the anon key or a guest's
-- session can create one. Rows arrive only from the edge functions, on the
-- service role, after Stripe has said the money is in (the same rule 0023 set
-- for paid ticket orders, for the same reason).
--
-- The claim code is the QR. It is random and long enough not to be guessed,
-- and it is only ever shown to the buyer (their own row) and to admins. The
-- handover is redeem_store_order(), which only an admin can call, and which
-- marks it in one statement so two staff scanning the same code at once can't
-- both hand a prize over.

-- ------------------------------------------------------------ products --

create table if not exists public.store_products (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (length(btrim(name)) between 1 and 80),
  blurb       text        not null default '',
  -- $1 to $1,000. A typo in the dashboard shouldn't be able to list a
  -- keychain at five figures.
  price_cents int         not null check (price_cents between 100 and 100000),
  -- A path in the public site-images bucket (0012), under store/.
  image_path  text,
  -- Null means no limit. Otherwise the checkout refuses once sold reaches it.
  stock       int         check (stock is null or stock >= 0),
  sold        int         not null default 0 check (sold >= 0),
  active      boolean     not null default true,
  sort        int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.store_products enable row level security;

drop policy if exists "anyone reads products on sale" on public.store_products;
create policy "anyone reads products on sale" on public.store_products for select
  using (active or public.is_admin());

drop policy if exists "admins add products" on public.store_products;
create policy "admins add products" on public.store_products for insert
  with check (public.is_admin());

drop policy if exists "admins edit products" on public.store_products;
create policy "admins edit products" on public.store_products for update
  using (public.is_admin());

drop policy if exists "admins delete products" on public.store_products;
create policy "admins delete products" on public.store_products for delete
  using (public.is_admin());

-- -------------------------------------------------------------- orders --

create table if not exists public.store_orders (
  id                uuid primary key default gen_random_uuid(),
  -- Kept when a product is deleted, so the record of a sale outlives the
  -- listing - the name and price are copied below for the same reason.
  product_id        uuid references public.store_products on delete set null,
  product_name      text        not null,
  qty               int         not null default 1 check (qty between 1 and 20),
  amount_cents      int         not null,
  user_id           uuid references auth.users on delete set null,
  buyer_name        text        not null default '',
  buyer_email       text        not null default '',
  buyer_phone       text,
  buyer_handle      text,
  stripe_session_id text        not null unique,
  stripe_invoice_id text,
  invoice_number    text,
  invoice_url       text,
  claim_code        text        not null unique,
  paid_at           timestamptz not null default now(),
  redeemed_at       timestamptz,
  redeemed_by       uuid references auth.users on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists store_orders_user_idx on public.store_orders (user_id);
create index if not exists store_orders_paid_idx on public.store_orders (paid_at desc);

alter table public.store_orders enable row level security;

drop policy if exists "buyers and admins read store orders" on public.store_orders;
create policy "buyers and admins read store orders" on public.store_orders for select
  using (auth.uid() = user_id or public.is_admin());

-- No insert policy, on purpose: see the note at the top.

-- ----------------------------------------------------------- handover --

-- Staff scan the QR, see who it is, and tap HAND OVER. Returns the order
-- whether or not this call was the one that marked it, plus `just_redeemed`,
-- so the screen can say "already handed over at 11:42" rather than a bare no.
create or replace function public.redeem_store_order(p_code text)
returns table (
  id            uuid,
  product_name  text,
  qty           int,
  buyer_name    text,
  buyer_handle  text,
  redeemed_at   timestamptz,
  just_redeemed boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  hit uuid;
begin
  if not public.is_admin() then
    raise exception 'Only staff can hand over prizes.';
  end if;

  update public.store_orders o
     set redeemed_at = now(), redeemed_by = auth.uid()
   where o.claim_code = p_code and o.redeemed_at is null
  returning o.id into hit;

  return query
    select o.id, o.product_name, o.qty, o.buyer_name, o.buyer_handle, o.redeemed_at,
           coalesce(o.id = hit, false) as just_redeemed
      from public.store_orders o
     where o.claim_code = p_code;
end;
$$;

revoke all on function public.redeem_store_order(text) from public;
grant execute on function public.redeem_store_order(text) to authenticated;

-- An admin undoing a handover tapped by mistake.
create or replace function public.unredeem_store_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only staff can change a handover.';
  end if;
  update public.store_orders set redeemed_at = null, redeemed_by = null where id = p_id;
end;
$$;

revoke all on function public.unredeem_store_order(uuid) from public;
grant execute on function public.unredeem_store_order(uuid) to authenticated;

-- The edge functions count a sale in one statement, so two payments landing
-- together can't both read the same `sold` and write the same +1.
create or replace function public.store_count_sale(p_product uuid, p_qty int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.store_products
     set sold = sold + greatest(p_qty, 0), updated_at = now()
   where id = p_product;
$$;

revoke all on function public.store_count_sale(uuid, int) from public, anon, authenticated;
grant execute on function public.store_count_sale(uuid, int) to service_role;
