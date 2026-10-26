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
