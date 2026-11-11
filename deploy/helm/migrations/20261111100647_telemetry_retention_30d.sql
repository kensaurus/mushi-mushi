-- 30-day retention for three telemetry tables (owner-approved 2026-11-11).
--
-- integration_health_history (465k rows, 132 MB; one row per probe per
-- integration every 15 minutes), webhook_audit_log (184k rows, 104 MB) and
-- pipeline_runs (125k rows, 20 MB) had no retention. Every reader looks back
-- at most 14 days or reads the newest N rows: the console's health history
-- and integration cards, the dashboard roll-up (14 days), SOC 2 evidence
-- (7 days), webhook replay and rate checks (24 hours), and the radar's
-- "webhook never delivered" rule, whose 7-day grace still fits in 30 days.
-- Nothing reads pipeline_runs back.
--
-- Rows deleted on the first run were dumped first
-- (kensaurus-db-dumps-2026-11-11/mushi/<table>.json, outside the repo).
-- Deletes run in batches so no single statement holds long locks or a huge
-- WAL burst; the space is reused by new rows (no VACUUM FULL).

create or replace function mushi.prune_telemetry(
  p_days integer default 30,
  p_batch integer default 5000,
  p_max_batches integer default 200
)
returns table (table_name text, deleted bigint)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10min'
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_days, 30));
  v_n bigint;
  v_total bigint;
  i integer;
begin
  -- integration_health_history
  v_total := 0;
  for i in 1..p_max_batches loop
    delete from public.integration_health_history
     where id in (
       select id from public.integration_health_history
        where checked_at < v_cutoff
        limit p_batch
     );
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < p_batch;
  end loop;
  table_name := 'integration_health_history'; deleted := v_total; return next;

  -- webhook_audit_log
  v_total := 0;
  for i in 1..p_max_batches loop
    delete from public.webhook_audit_log
     where id in (
       select id from public.webhook_audit_log
        where created_at < v_cutoff
        limit p_batch
     );
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < p_batch;
  end loop;
  table_name := 'webhook_audit_log'; deleted := v_total; return next;

  -- pipeline_runs
  v_total := 0;
  for i in 1..p_max_batches loop
    delete from public.pipeline_runs
     where id in (
       select id from public.pipeline_runs
        where started_at < v_cutoff
        limit p_batch
     );
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < p_batch;
  end loop;
  table_name := 'pipeline_runs'; deleted := v_total; return next;
end;
$$;

revoke all on function mushi.prune_telemetry(integer, integer, integer) from public, anon, authenticated;

-- Daily, in the quiet 05:xx block next to the other retention jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mushi-telemetry-retention') then
    perform cron.unschedule('mushi-telemetry-retention');
  end if;
  perform cron.schedule('mushi-telemetry-retention', '53 5 * * *', $cmd$select mushi.prune_telemetry();$cmd$);
end
$$;
