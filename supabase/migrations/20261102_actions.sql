-- Action Center: concrete actions proposed by Nova's agents, approved by the
-- founder, executed by the server, with provider evidence and an HMAC
-- receipt. Founders read their own; only the Nova server writes.
-- Safe to run more than once.
create table if not exists public.nova_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.nova_workspaces(id) on delete cascade,
  kind text not null check (kind in ('lead_followup', 'offer_go_live')),
  title text not null check (char_length(title) between 1 and 160),
  summary text check (summary is null or char_length(summary) <= 600),
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('proposed', 'approved', 'executing', 'succeeded', 'failed', 'rejected')),
  source text not null default 'operator' check (source in ('operator', 'mission', 'founder')),
  dedupe_key text not null check (char_length(dedupe_key) <= 160),
  approver_email text check (approver_email is null or char_length(approver_email) <= 254),
  decided_at timestamptz,
  executed_at timestamptz,
  evidence jsonb,
  receipt text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nova_actions_workspace_created_idx on public.nova_actions (workspace_id, created_at desc);
-- At most one open action per company and purpose.
create unique index if not exists nova_actions_open_dedupe_idx on public.nova_actions (workspace_id, dedupe_key) where status in ('proposed', 'approved', 'executing');
alter table public.nova_actions enable row level security;
revoke all on public.nova_actions from anon, authenticated;
grant select on public.nova_actions to authenticated;
grant select, insert, update, delete on public.nova_actions to service_role;

drop policy if exists "Owners can read Nova actions" on public.nova_actions;
create policy "Owners can read Nova actions" on public.nova_actions for select to authenticated
  using (exists (select 1 from public.nova_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
