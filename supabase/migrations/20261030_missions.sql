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
