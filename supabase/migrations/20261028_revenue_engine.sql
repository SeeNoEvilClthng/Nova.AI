-- Revenue Engine: each company's own Stripe connection (encrypted restricted
-- key, server-only) and a verified order ledger synced from Stripe. Founders
-- can read their own orders; only the Nova server can write either table.
-- Safe to run more than once.

create table if not exists public.nova_payment_connections (
  workspace_id uuid primary key references public.nova_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  mode text not null check (mode in ('test', 'live')),
  encrypted_key text not null,
  key_iv text not null,
  key_tag text not null,
  key_hint text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.nova_payment_connections enable row level security;
revoke all on public.nova_payment_connections from anon, authenticated;
grant select, insert, update, delete on public.nova_payment_connections to service_role;

create table if not exists public.nova_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  provider text not null check (provider in ('stripe')),
  external_id text not null,
  offer_id text,
  mode text not null check (mode in ('test', 'live')),
  status text not null default 'paid' check (status in ('paid')),
  amount_minor bigint not null check (amount_minor >= 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  currency text not null check (char_length(currency) = 3),
  customer_email text check (customer_email is null or char_length(customer_email) <= 254),
  paid_at timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists nova_orders_workspace_paid_idx on public.nova_orders (workspace_id, paid_at desc);
alter table public.nova_orders enable row level security;
revoke all on public.nova_orders from anon, authenticated;
grant select on public.nova_orders to authenticated;
grant select, insert, update, delete on public.nova_orders to service_role;

drop policy if exists "Owners can read Nova orders" on public.nova_orders;
create policy "Owners can read Nova orders" on public.nova_orders for select to authenticated
  using (exists (select 1 from public.nova_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
