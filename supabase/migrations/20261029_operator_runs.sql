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
