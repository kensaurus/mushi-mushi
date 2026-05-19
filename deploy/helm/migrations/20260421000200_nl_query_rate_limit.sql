-- Wave S1 / S-3: Per-user rate limit for the NL-to-SQL endpoint.
--
-- The `/v1/admin/query` endpoint runs an LLM → SQL → summarizer chain on
-- every request. A compromised admin account, a runaway script, or a
-- misbehaving plugin could hammer it and burn both LLM spend and database
-- statement_timeout slots.
--
-- We don't need a sophisticated token bucket — admins are humans, not
-- services. A simple sliding-window counter per (user_id, hour) with an
-- atomic UPSERT gives us back-pressure at DB granularity without any
-- external dependency (Redis, Durable Objects, etc.). The window is
-- intentionally coarse so we rarely contend on a single row.

create table if not exists nl_query_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, window_start)
);

create index if not exists nl_query_rate_limits_user_window_idx
  on nl_query_rate_limits (user_id, window_start desc);

-- Atomic "claim a token" function. Returns the new count (post-increment)
-- when under the limit, or raises `rate_limit_exceeded` otherwise.
-- Default: 60 requests/hour. Overridable per user via the `limits` jsonb
-- on auth.users.raw_app_meta_data.nl_query_hourly_limit (future hook).
create or replace function nl_query_rate_limit_claim(
  p_user_id uuid,
  p_max_per_hour integer default 60
) returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_count integer;
begin
  insert into nl_query_rate_limits (user_id, window_start, request_count)
  values (p_user_id, v_window, 1)
  on conflict (user_id, window_start)
    do update set request_count = nl_query_rate_limits.request_count + 1
  returning request_count into v_count;

  if v_count > p_max_per_hour then
    raise exception 'rate_limit_exceeded: % queries this hour (cap=%)', v_count, p_max_per_hour
      using errcode = 'P0001';
  end if;

  return v_count;
end;
$$;

revoke all on function nl_query_rate_limit_claim(uuid, integer) from public;
grant execute on function nl_query_rate_limit_claim(uuid, integer) to service_role;

-- Retention: prune buckets older than 7 days so the table stays small.
-- Non-idempotency is fine: a cron job calls this on a schedule; if it
-- ever fails we retry.
create or replace function nl_query_rate_limit_prune(p_older_than interval default '7 days')
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_deleted integer;
begin
  delete from nl_query_rate_limits
   where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function nl_query_rate_limit_prune(interval) from public;
grant execute on function nl_query_rate_limit_prune(interval) to service_role;

-- RLS on the table so a curious admin can't read other admins' counters.
alter table nl_query_rate_limits enable row level security;
create policy "nl_query_rate_limits_self_read" on nl_query_rate_limits
  for select using ((select auth.uid()) = user_id);
