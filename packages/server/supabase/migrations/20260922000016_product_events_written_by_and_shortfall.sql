-- ============================================================================
-- 20260922000016_product_events_written_by_and_shortfall
--
-- Audit #52 (server-side residue):
--
-- 1. product_events.written_by: 'server' for rows emitProductEvent writes
--    (_shared/product-events.ts), 'sdk' for everything POST /v1/sdk/events
--    stores. Surfaces overlap (report_opened is 'console' from the browser and
--    'mcp' from the server), so the writer is recorded explicitly.
-- 2. A server milestone that fails to emit is silent: emitProductEvent is
--    fire-and-forget and logs a warning. mushi.product_event_shortfall_check()
--    compares yesterday's new projects with the project_created events the
--    self project received and writes a 'degraded' cron_runs row
--    (job_name 'product-events:project_created') when any are missing, so the
--    console health page shows the gap. Daily at 04:45 UTC.
-- ============================================================================

alter table public.product_events
  add column if not exists written_by text not null default 'sdk'
  constraint product_events_written_by_check check (written_by in ('sdk', 'server'));

comment on column public.product_events.written_by is
  'Who stored the row: sdk (POST /v1/sdk/events) or server (emitProductEvent).';

create or replace function mushi.product_event_shortfall_check()
returns integer
language plpgsql
security definer
set search_path = public, mushi
as $fn$
declare
  v_self    uuid;
  v_created integer;
  v_missing integer;
begin
  select nullif(value, '')::uuid into v_self
    from public.mushi_runtime_config where key = 'self_project_id';
  if v_self is null then
    return 0;
  end if;

  select count(*),
         count(*) filter (where not exists (
           select 1 from public.product_events e
            where e.project_id = v_self
              and e.event_name = 'project_created'
              and e.properties ->> 'project_id' = p.id::text))
    into v_created, v_missing
    from public.projects p
   where p.created_at >= now() - interval '25 hours'
     and p.created_at <  now() - interval '1 hour';

  if v_created = 0 then
    return 0;
  end if;

  insert into public.cron_runs (job_name, trigger, started_at, finished_at, status, rows_affected, error_message, metadata)
  values (
    'product-events:project_created',
    'cron',
    now(),
    now(),
    case when v_missing > 0 then 'degraded' else 'success' end,
    v_created,
    case when v_missing > 0
      then v_missing || ' of ' || v_created || ' projects created in the last day have no project_created event'
    end,
    jsonb_build_object('created', v_created, 'missing', v_missing, 'source', 'mushi.product_event_shortfall_check')
  );
  return v_missing;
end;
$fn$;

revoke all on function mushi.product_event_shortfall_check() from public, anon, authenticated;

select cron.schedule('mushi-product-event-shortfall', '45 4 * * *',
  $$select mushi.product_event_shortfall_check();$$);
