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
