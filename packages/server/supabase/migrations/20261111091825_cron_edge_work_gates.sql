-- Per-minute edge crons fire only when there is work (2026-11-11 cost audit).
--
-- `mushi-plugin-dispatch-retry` and `qa-story-runner-tick` called an edge
-- function every minute: about 2,880 invocations a day, nearly all of them
-- finding nothing to do (plugin_dispatch_log held 1 row, none due; QA
-- stories are scheduled on ~30 distinct minutes an hour). Each job now asks
-- the database first and posts to the function only when that function has
-- work, so the cadence (and the latency of a retry or a scheduled story) is
-- unchanged while idle ticks cost a cheap indexed query instead of an edge
-- invocation plus a cron_runs row.

-- One 5-field cron field against a value, the way qa-story-runner's
-- cronMatches() reads it ('*', '*/n', 'a,b,c'). Anything else answers true:
-- the gate may only over-fire (the edge function re-checks), never skip a
-- run the function would have made.
create or replace function mushi.cron_field_may_match(p_field text, p_value integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_field = '*' then true
    when p_field ~ '^\*/[0-9]{1,4}$' then
      substr(p_field, 3)::integer > 0 and p_value % substr(p_field, 3)::integer = 0
    when p_field ~ '^[0-9]{1,4}(,[0-9]{1,4})*$' then
      p_value = any (string_to_array(p_field, ',')::integer[])
    else true
  end
$$;

-- Does qa-story-runner have work at p_now? Mirrors the function's cron path:
-- an enabled story whose schedule matches the minute (null schedule means
-- '*/15'; fewer than 5 fields means always), or a manual run still pending
-- after 10 minutes (sweepAbandonedManualRuns, ABANDONED_MANUAL_RUN_MS).
create or replace function mushi.qa_story_runner_has_work(p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select (p_now at time zone 'UTC') as u
  )
  select exists (
    select 1
    from public.qa_stories s
    cross join t
    cross join lateral (
      select regexp_split_to_array(btrim(coalesce(s.schedule_cron, '*/15 * * * *')), '\s+') as f
    ) parts
    where s.enabled = true
      and (
        coalesce(array_length(parts.f, 1), 0) < 5
        or (
          mushi.cron_field_may_match(parts.f[1], extract(minute from t.u)::integer)
          and mushi.cron_field_may_match(parts.f[2], extract(hour from t.u)::integer)
          and mushi.cron_field_may_match(parts.f[3], extract(day from t.u)::integer)
          and mushi.cron_field_may_match(parts.f[4], extract(month from t.u)::integer)
          and mushi.cron_field_may_match(parts.f[5], extract(dow from t.u)::integer)
        )
      )
  )
  or exists (
    select 1
    from public.qa_story_runs r
    where r.status = 'pending'
      and r.triggered_by = 'manual'
      and r.started_at < p_now - interval '10 minutes'
  )
$$;

-- Does plugin-dispatch-retry have work? The same predicate
-- claim_plugin_dispatch_retries() claims with (including the 5-minute
-- reclaim of a lease a dead worker left behind).
create or replace function mushi.plugin_dispatch_retry_has_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plugin_dispatch_log d
    where d.status = 'pending'
      and d.next_retry_at is not null
      and d.next_retry_at <= now()
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
  )
$$;

revoke all on function mushi.cron_field_may_match(text, integer) from public, anon, authenticated;
revoke all on function mushi.qa_story_runner_has_work(timestamptz) from public, anon, authenticated;
revoke all on function mushi.plugin_dispatch_retry_has_work() from public, anon, authenticated;

-- Same names, same schedule ('* * * * *'), same call; only the guard is new.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mushi-plugin-dispatch-retry') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'mushi-plugin-dispatch-retry'),
      command := $cmd$select mushi.edge_function_post('plugin-dispatch-retry', '{}'::jsonb) where mushi.plugin_dispatch_retry_has_work();$cmd$
    );
  end if;
  if exists (select 1 from cron.job where jobname = 'qa-story-runner-tick') then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'qa-story-runner-tick'),
      command := $cmd$select mushi.edge_function_post('qa-story-runner', '{"trigger":"cron"}'::jsonb) where mushi.qa_story_runner_has_work(now());$cmd$
    );
  end if;
end
$$;
