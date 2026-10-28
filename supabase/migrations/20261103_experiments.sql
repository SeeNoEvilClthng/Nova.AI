-- Launch-page A/B tests. Page events are tagged with the experiment and the
-- version the visitor saw; one running test per page; founders read their
-- own tests and only the Nova server writes. Also allows the new Action
-- Center kind that applies a test result. Safe to run more than once.
create table if not exists public.nova_experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  page_id uuid not null references public.nova_published_pages(id) on delete cascade,
  status text not null check (status in ('running', 'completed')),
  variants jsonb not null,
  winner text check (winner is null or winner in ('a', 'b')),
  applied_variant text check (applied_variant is null or applied_variant in ('a', 'b')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists nova_experiments_workspace_created_idx on public.nova_experiments (workspace_id, created_at desc);
create unique index if not exists nova_experiments_one_running_idx on public.nova_experiments (page_id) where status = 'running';
alter table public.nova_experiments enable row level security;
revoke all on public.nova_experiments from anon, authenticated;
grant select on public.nova_experiments to authenticated;
grant select, insert, update, delete on public.nova_experiments to service_role;

drop policy if exists "Owners can read Nova experiments" on public.nova_experiments;
create policy "Owners can read Nova experiments" on public.nova_experiments for select to authenticated
  using (exists (select 1 from public.nova_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

alter table public.nova_page_events
  add column if not exists experiment_id uuid,
  add column if not exists variant text check (variant is null or variant in ('a', 'b'));
create index if not exists nova_page_events_experiment_idx on public.nova_page_events (page_id, experiment_id) where experiment_id is not null;

alter table public.nova_actions drop constraint if exists nova_actions_kind_check;
alter table public.nova_actions add constraint nova_actions_kind_check check (kind in ('lead_followup', 'offer_go_live', 'page_headline_update'));
