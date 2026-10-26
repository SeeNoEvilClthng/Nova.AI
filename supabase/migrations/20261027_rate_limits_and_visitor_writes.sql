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
