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
