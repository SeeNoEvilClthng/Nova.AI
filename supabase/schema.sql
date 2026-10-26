create extension if not exists pgcrypto;

create table if not exists public.nova_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  state jsonb not null default '{"plan":null,"approved":false,"activities":[],"evaluation":null}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nova_workspaces_user_updated_idx
  on public.nova_workspaces (user_id, updated_at desc);

alter table public.nova_workspaces enable row level security;

revoke all on table public.nova_workspaces from anon;
grant select, insert, update, delete on table public.nova_workspaces to authenticated;

drop policy if exists "Users can read their own Nova workspaces" on public.nova_workspaces;
create policy "Users can read their own Nova workspaces"
  on public.nova_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Nova workspaces" on public.nova_workspaces;
create policy "Users can create their own Nova workspaces"
  on public.nova_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Nova workspaces" on public.nova_workspaces;
create policy "Users can update their own Nova workspaces"
  on public.nova_workspaces for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own Nova workspaces" on public.nova_workspaces;
create policy "Users can delete their own Nova workspaces"
  on public.nova_workspaces for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.nova_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  tier text check (tier in ('starter', 'builder', 'operator')),
  status text not null default 'incomplete',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.nova_subscriptions enable row level security;

revoke all on table public.nova_subscriptions from anon, authenticated;
grant select on table public.nova_subscriptions to authenticated;
grant select, insert, update, delete on table public.nova_subscriptions to service_role;

drop policy if exists "Users can read their own Nova subscription" on public.nova_subscriptions;
create policy "Users can read their own Nova subscription"
  on public.nova_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.nova_validation_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  respondent_name text not null check (char_length(respondent_name) between 1 and 100),
  respondent_email text check (respondent_email is null or char_length(respondent_email) <= 254),
  notes text not null check (char_length(notes) between 1 and 4000),
  demand_score smallint not null check (demand_score between 1 and 5),
  urgency_score smallint not null check (urgency_score between 1 and 5),
  willingness_score smallint not null check (willingness_score between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists nova_validation_user_workspace_created_idx
  on public.nova_validation_entries (user_id, workspace_id, created_at desc);
create index if not exists nova_validation_workspace_idx
  on public.nova_validation_entries (workspace_id);

alter table public.nova_validation_entries enable row level security;
revoke all on table public.nova_validation_entries from anon, authenticated;
grant select, insert, delete on table public.nova_validation_entries to authenticated;

drop policy if exists "Users can read their own validation evidence" on public.nova_validation_entries;
create policy "Users can read their own validation evidence"
  on public.nova_validation_entries for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add evidence to their own workspace" on public.nova_validation_entries;
create policy "Users can add evidence to their own workspace"
  on public.nova_validation_entries for insert to authenticated
  with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.nova_workspaces
      where nova_workspaces.id = workspace_id
        and nova_workspaces.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can delete their own validation evidence" on public.nova_validation_entries;
create policy "Users can delete their own validation evidence"
  on public.nova_validation_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.nova_published_pages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null unique references public.nova_workspaces(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'), title text not null check (char_length(title) between 1 and 100),
  snapshot jsonb not null, published boolean not null default false, published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists nova_published_pages_user_idx on public.nova_published_pages(user_id);
alter table public.nova_published_pages enable row level security;
revoke all on public.nova_published_pages from anon, authenticated;
grant select on public.nova_published_pages to anon;
grant select, insert, update, delete on public.nova_published_pages to authenticated;
create policy "Public can read published Nova pages" on public.nova_published_pages for select to anon using (published = true);
create policy "Owners can read Nova pages" on public.nova_published_pages for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners can create Nova pages" on public.nova_published_pages for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.nova_workspaces w where w.id=workspace_id and w.user_id=(select auth.uid())));
create policy "Owners can update Nova pages" on public.nova_published_pages for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Owners can delete Nova pages" on public.nova_published_pages for delete to authenticated using ((select auth.uid())=user_id);

create table if not exists public.nova_page_leads (
  id uuid primary key default gen_random_uuid(), page_id uuid not null references public.nova_published_pages(id) on delete cascade,
  email text not null check (char_length(email)<=254), status text not null default 'new' check(status in ('new','contacted','qualified','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(page_id,email)
);
create index if not exists nova_page_leads_page_created_idx on public.nova_page_leads(page_id,created_at desc);
alter table public.nova_page_leads enable row level security;
revoke all on public.nova_page_leads from anon, authenticated;
grant insert on public.nova_page_leads to anon; grant select, update on public.nova_page_leads to authenticated;
create policy "Visitors can join published Nova pages" on public.nova_page_leads for insert to anon with check (exists(select 1 from public.nova_published_pages p where p.id=page_id and p.published));
create policy "Owners can read Nova page leads" on public.nova_page_leads for select to authenticated using (exists(select 1 from public.nova_published_pages p where p.id=page_id and p.user_id=(select auth.uid())));
create policy "Owners can update Nova page leads" on public.nova_page_leads for update to authenticated
using (exists(select 1 from public.nova_published_pages p where p.id=page_id and p.user_id=(select auth.uid())))
with check (exists(select 1 from public.nova_published_pages p where p.id=page_id and p.user_id=(select auth.uid())));

create table if not exists public.nova_page_events (
  id bigint generated always as identity primary key, page_id uuid not null references public.nova_published_pages(id) on delete cascade,
  event_type text not null check(event_type in ('view','signup')), created_at timestamptz not null default now()
);
create index if not exists nova_page_events_page_type_idx on public.nova_page_events(page_id,event_type);
alter table public.nova_page_events enable row level security;
revoke all on public.nova_page_events from anon, authenticated;
grant insert on public.nova_page_events to anon; grant select on public.nova_page_events to authenticated;
grant usage,select on sequence public.nova_page_events_id_seq to anon;
create policy "Visitors can record published Nova page events" on public.nova_page_events for insert to anon with check (exists(select 1 from public.nova_published_pages p where p.id=page_id and p.published));
create policy "Owners can read Nova page events" on public.nova_page_events for select to authenticated using (exists(select 1 from public.nova_published_pages p where p.id=page_id and p.user_id=(select auth.uid())));

-- OAuth credentials are encrypted by the Nova server before storage. This
-- table is intentionally unavailable through the public Data API, including
-- to authenticated users; only the server secret may read or write it.
create table if not exists public.nova_social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  provider text not null check (provider in ('instagram')),
  account_id text not null,
  username text not null,
  encrypted_token text not null,
  token_iv text not null,
  token_tag text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id, provider)
);
create index if not exists nova_social_connections_owner_idx on public.nova_social_connections(user_id, workspace_id);
create index if not exists nova_social_connections_workspace_idx on public.nova_social_connections(workspace_id);
alter table public.nova_social_connections enable row level security;
revoke all on public.nova_social_connections from anon, authenticated;
grant select, insert, update, delete on public.nova_social_connections to service_role;

-- Meta fetches approved graphics from this public bucket. Write and management
-- access remains limited to the signed-in owner's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nova-social-media', 'nova-social-media', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Nova users can upload their own social media" on storage.objects;
create policy "Nova users can upload their own social media" on storage.objects for insert to authenticated
with check (bucket_id='nova-social-media' and (storage.foldername(name))[1]=(select auth.uid()::text));

drop policy if exists "Nova users can list their own social media" on storage.objects;
create policy "Nova users can list their own social media" on storage.objects for select to authenticated
using (bucket_id='nova-social-media' and owner_id=(select auth.uid()::text));

drop policy if exists "Nova users can delete their own social media" on storage.objects;
create policy "Nova users can delete their own social media" on storage.objects for delete to authenticated
using (bucket_id='nova-social-media' and owner_id=(select auth.uid()::text));

-- Server-authoritative AI usage ledger. Only the Nova server (service role)
-- can write; owners can read their own workspaces' rows. The AI budget is
-- enforced from this table so it can no longer be lowered by editing the
-- client-saved workspace state. Safe to run more than once.
create table if not exists public.nova_ai_usage_events (
  id bigint generated always as identity primary key,
  generation_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  operation text not null check (char_length(operation) between 1 and 60),
  provider text not null check (char_length(provider) between 1 and 60),
  model text not null check (char_length(model) between 1 and 120),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  fallback boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, generation_id)
);

create index if not exists nova_ai_usage_workspace_created_idx
  on public.nova_ai_usage_events (workspace_id, created_at desc);

alter table public.nova_ai_usage_events enable row level security;
revoke all on public.nova_ai_usage_events from anon, authenticated;
grant select on public.nova_ai_usage_events to authenticated;
grant select, insert on public.nova_ai_usage_events to service_role;

drop policy if exists "Owners can read Nova AI usage" on public.nova_ai_usage_events;
create policy "Owners can read Nova AI usage" on public.nova_ai_usage_events for select to authenticated
  using (exists (select 1 from public.nova_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

-- security invoker: row level security above limits the sum to the caller's
-- own workspaces.
create or replace function public.nova_workspace_ai_tokens(target uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(total_tokens), 0)::bigint from public.nova_ai_usage_events where workspace_id = target;
$$;

revoke all on function public.nova_workspace_ai_tokens(uuid) from public, anon;
grant execute on function public.nova_workspace_ai_tokens(uuid) to authenticated;

-- 1. Shared rate-limit counters used by every server instance. Keys are HMACs
--    of the client identity; raw IP addresses are never stored.
-- 2. Visitor writes (page views, waitlist signups) now go only through the
--    Nova server, which rate limits them. Anonymous Data API inserts are
--    revoked so they can no longer inflate analytics or bypass limits.
-- Deploy the matching code BEFORE running this file: older code inserts
-- visitor rows with the anonymous key and would start failing. Safe to re-run.

create table if not exists public.nova_rate_limits (
  bucket text primary key check (char_length(bucket) <= 120),
  window_start timestamptz not null default now(),
  hits integer not null default 0
);
alter table public.nova_rate_limits enable row level security;
revoke all on public.nova_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.nova_rate_limits to service_role;

-- Fixed-window counter. Returns true when the bucket is over max_hits.
create or replace function public.nova_rate_limit_hit(bucket_key text, max_hits integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_hits integer;
  expired boolean;
begin
  insert into public.nova_rate_limits as r (bucket, window_start, hits)
  values (bucket_key, now(), 1)
  on conflict (bucket) do update set
    hits = case when r.window_start < now() - make_interval(secs => window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => window_seconds) then now() else r.window_start end
  returning hits into current_hits;
  -- Occasionally clear buckets idle for over a day.
  if random() < 0.01 then
    delete from public.nova_rate_limits where window_start < now() - interval '1 day';
  end if;
  return current_hits > max_hits;
end;
$$;
revoke all on function public.nova_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.nova_rate_limit_hit(text, integer, integer) to service_role;

drop policy if exists "Visitors can join published Nova pages" on public.nova_page_leads;
drop policy if exists "Visitors can record published Nova page events" on public.nova_page_events;
revoke insert on public.nova_page_leads from anon;
revoke insert on public.nova_page_events from anon;
revoke usage, select on sequence public.nova_page_events_id_seq from anon;
grant insert on public.nova_page_leads to service_role;
grant insert on public.nova_page_events to service_role;
grant usage, select on sequence public.nova_page_events_id_seq to service_role;

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

-- Autonomous Operator run log: one row per daily or manual operating cycle,
-- with the metrics it saw, the CEO brief, any Autopilot drafts, model and
-- token use. This is the audit trail for everything the operator did.
-- Only the Nova server writes it; founders read their own. Safe to re-run.
create table if not exists public.nova_operator_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  mode text not null check (mode in ('copilot', 'supervised', 'autopilot')),
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  metrics jsonb,
  brief jsonb,
  drafts jsonb,
  model text,
  tokens integer not null default 0 check (tokens >= 0),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists nova_operator_runs_workspace_started_idx on public.nova_operator_runs (workspace_id, started_at desc);
alter table public.nova_operator_runs enable row level security;
revoke all on public.nova_operator_runs from anon, authenticated;
grant select on public.nova_operator_runs to authenticated;
grant select, insert, update, delete on public.nova_operator_runs to service_role;

drop policy if exists "Owners can read Nova operator runs" on public.nova_operator_runs;
create policy "Owners can read Nova operator runs" on public.nova_operator_runs for select to authenticated
  using (exists (select 1 from public.nova_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

-- Durable missions as rows instead of entries in the browser-saved workspace
-- blob. Each step's result is saved as it completes; locked_until is a short
-- lease so only one server instance advances a mission at a time.
-- Founders read their own missions; only the Nova server writes. Safe to re-run.
create table if not exists public.nova_missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  company text not null check (char_length(company) between 1 and 100),
  objective text not null check (char_length(objective) between 12 and 1200),
  status text not null check (status in ('running', 'awaiting_approval', 'executing', 'completed', 'rejected', 'failed')),
  resume_status text check (resume_status is null or resume_status in ('running', 'executing')),
  steps jsonb not null default '[]'::jsonb,
  decision jsonb,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nova_missions_workspace_created_idx on public.nova_missions (workspace_id, created_at desc);
create index if not exists nova_missions_active_idx on public.nova_missions (status, updated_at) where status in ('running', 'executing');
alter table public.nova_missions enable row level security;
revoke all on public.nova_missions from anon, authenticated;
grant select on public.nova_missions to authenticated;
grant select, insert, update, delete on public.nova_missions to service_role;

drop policy if exists "Owners can read Nova missions" on public.nova_missions;
create policy "Owners can read Nova missions" on public.nova_missions for select to authenticated
  using (exists (select 1 from public.nova_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

-- Growth: first-touch attribution on page views, signups and orders, plus a
-- log of founder-approved follow-up emails and lead unsubscribes.
-- The app keeps working before this runs (writes skip the new columns).
-- Safe to run more than once.

alter table public.nova_page_events
  add column if not exists visitor_id text check (visitor_id is null or char_length(visitor_id) <= 64),
  add column if not exists utm_source text check (utm_source is null or char_length(utm_source) <= 80),
  add column if not exists utm_medium text check (utm_medium is null or char_length(utm_medium) <= 80),
  add column if not exists utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 80),
  add column if not exists referrer_host text check (referrer_host is null or char_length(referrer_host) <= 120);
create index if not exists nova_page_events_page_created_idx on public.nova_page_events (page_id, created_at desc);

alter table public.nova_page_leads
  add column if not exists visitor_id text check (visitor_id is null or char_length(visitor_id) <= 64),
  add column if not exists utm_source text check (utm_source is null or char_length(utm_source) <= 80),
  add column if not exists utm_medium text check (utm_medium is null or char_length(utm_medium) <= 80),
  add column if not exists utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 80),
  add column if not exists referrer_host text check (referrer_host is null or char_length(referrer_host) <= 120),
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists last_contacted_at timestamptz;

alter table public.nova_orders
  add column if not exists client_reference_id text check (client_reference_id is null or char_length(client_reference_id) <= 64);

create table if not exists public.nova_email_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  lead_id uuid references public.nova_page_leads(id) on delete set null,
  batch_id uuid not null,
  email text not null check (char_length(email) <= 254),
  subject text not null check (char_length(subject) <= 150),
  status text not null check (status in ('sent', 'failed')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists nova_email_sends_workspace_created_idx on public.nova_email_sends (workspace_id, created_at desc);
alter table public.nova_email_sends enable row level security;
revoke all on public.nova_email_sends from anon, authenticated;
grant select on public.nova_email_sends to authenticated;
grant select, insert, update, delete on public.nova_email_sends to service_role;

drop policy if exists "Owners can read Nova email sends" on public.nova_email_sends;
create policy "Owners can read Nova email sends" on public.nova_email_sends for select to authenticated
  using (exists (select 1 from public.nova_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
