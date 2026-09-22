-- ============================================================================
-- 20260922000010_cron_repairs_and_http_watchdog
--
-- Four pg_cron jobs had failed on every run for months, and every HTTP cron
-- job was invisible when its function refused the call: cron.job_run_details
-- says 'succeeded' because net.http_post only enqueues, and public.cron_runs
-- (what the console health page reads) never heard about it.
--
-- 1. expire-quest-progress (unique violation since 2026-07-19).
--    quest_progress_unique_active was UNIQUE (quest_id, end_user_id, status)
--    over every status, so a user could hold only one 'expired' row per quest
--    and the second expiry collided. The table comment and quest-tracker.ts
--    mean "one active run": the replacement keeps one 'in_progress' and one
--    'completed' row per (quest, end user) and allows any number of
--    'expired' / 'abandoned' history rows.
--
-- 2. HTTP crons go through one recording helper.
--    mushi.cron_http_post() posts with the same URL and auth header the jobs
--    already used (mushi_runtime_supabase_url + mushi_internal_auth_header),
--    and both it and mushi.edge_function_post log (request id, function) in
--    mushi.edge_function_calls. Job schedules, bodies and timeouts are
--    unchanged; jobs without an explicit timeout keep pg_net's 5 s default.
--    Repaired along the way:
--      - mushi-backend-drift-scanner-daily called
--        mushi_runtime_service_role_key(), which does not exist.
--      - recompute-tester-reputation read an 'edge_function_base_url' key
--        that is not set (null url) and app.service_role_key (unset).
--      - mushi-reward-payout-aggregator had doubled quotes (syntax error).
--        It is repaired but left INACTIVE: payouts have not launched (0 payout
--        accounts, 0 payouts). Enable with
--        select cron.alter_job(jobid, active := true) from cron.job
--         where jobname = 'mushi-reward-payout-aggregator';
--
-- 3. mushi.edge_call_watchdog(), every 10 minutes, joins the logged calls to
--    net._http_response and writes one public.cron_runs row per function
--    (job_name 'http:<function>'): 'error' for non-2xx, 'degraded' for
--    timeouts or no response after 30 minutes, 'success' at most hourly.
--
-- The 401s themselves (anomaly-detector, pdca-runner, backend-drift-scanner
-- and ten other internal functions deployed with verify_jwt = true, which
-- rejects the non-JWT internal secret before requireServiceRoleAuth runs) are
-- fixed in packages/server/supabase/config.toml and pinned by
-- packages/server/src/__tests__/internal-auth-contract.test.ts.
-- ============================================================================

-- ── 1. quest_progress uniqueness ─────────────────────────────────────────────
alter table public.quest_progress drop constraint if exists quest_progress_unique_active;

create unique index if not exists quest_progress_one_in_progress
  on public.quest_progress (quest_id, end_user_id)
  where status = 'in_progress';

create unique index if not exists quest_progress_one_completed
  on public.quest_progress (quest_id, end_user_id)
  where status = 'completed';

-- ── 2. call log + helpers ───────────────────────────────────────────────────
create table if not exists mushi.edge_function_calls (
  request_id bigint      primary key,
  fn_name    text        not null,
  called_at  timestamptz not null default now(),
  checked_at timestamptz
);

create index if not exists edge_function_calls_unchecked_idx
  on mushi.edge_function_calls (called_at)
  where checked_at is null;

alter table mushi.edge_function_calls enable row level security;
revoke all on mushi.edge_function_calls from public, anon, authenticated;

comment on table mushi.edge_function_calls is
  'pg_net request ids of cron-issued edge function calls, so mushi.edge_call_watchdog can attribute net._http_response status codes to a function.';

create or replace function mushi.cron_http_post(
  fn_name    text,
  body       jsonb   default '{}'::jsonb,
  timeout_ms integer default 5000
)
returns bigint
language plpgsql
security definer
set search_path = public, net
as $fn$
declare
  v_url  text := public.mushi_runtime_supabase_url();
  v_auth text := public.mushi_internal_auth_header();
  v_id   bigint;
begin
  -- Same guard the jobs had as a WHERE clause: without a URL or a token the
  -- call would only 401, so skip it.
  if v_url is null or v_auth is null then
    return null;
  end if;

  select net.http_post(
    url                  := v_url || '/functions/v1/' || fn_name,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_auth),
    body                 := body,
    timeout_milliseconds := timeout_ms
  ) into v_id;

  insert into mushi.edge_function_calls (request_id, fn_name)
  values (v_id, fn_name)
  on conflict (request_id) do nothing;

  return v_id;
end;
$fn$;

revoke all on function mushi.cron_http_post(text, jsonb, integer) from public, anon, authenticated;

-- Unchanged apart from logging the request id.
create or replace function mushi.edge_function_post(fn_name text, body jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
DECLARE
  v_url text;
  v_key text;
  request_id bigint;
BEGIN
  SELECT value INTO v_url FROM public.mushi_runtime_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.mushi_runtime_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'mushi.edge_function_post: mushi_runtime_config.supabase_url missing';
  END IF;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'mushi.edge_function_post: mushi_runtime_config.service_role_key missing (mirror MUSHI_INTERNAL_CALLER_SECRET here)';
  END IF;
  SELECT net.http_post(
    url := v_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'X-Mushi-Internal', 'cron'
    ),
    body := body,
    timeout_milliseconds := 300000
  ) INTO request_id;

  INSERT INTO mushi.edge_function_calls (request_id, fn_name)
  VALUES (request_id, fn_name)
  ON CONFLICT (request_id) DO NOTHING;

  RETURN request_id;
END;
$function$;

revoke all on function mushi.edge_function_post(text, jsonb) from public, anon, authenticated;

-- ── 3. watchdog ─────────────────────────────────────────────────────────────
create or replace function mushi.edge_call_watchdog()
returns integer
language plpgsql
security definer
set search_path = public, net, mushi
as $fn$
declare
  v_rows integer := 0;
begin
  with due as (
    select c.request_id,
           c.fn_name,
           c.called_at,
           r.status_code,
           coalesce(r.timed_out, false) as timed_out,
           r.error_msg,
           (r.id is not null)           as has_response
      from mushi.edge_function_calls c
      left join net._http_response r on r.id = c.request_id
     where c.checked_at is null
       and (r.id is not null or c.called_at < now() - interval '30 minutes')
       for update of c skip locked
  ),
  per_fn as (
    select fn_name,
           count(*)                                                        as calls,
           count(*) filter (where status_code between 200 and 299)         as ok,
           count(*) filter (where has_response and not timed_out and error_msg is null
                              and (status_code is null or status_code not between 200 and 299)) as failed,
           count(*) filter (where timed_out or error_msg is not null or not has_response)      as unknown,
           min(called_at)                                                  as first_at,
           jsonb_agg(distinct status_code) filter (where status_code is not null) as codes,
           (array_agg(error_msg order by called_at desc) filter (where error_msg is not null))[1] as last_error
      from due
     group by fn_name
  ),
  ins as (
    insert into public.cron_runs (job_name, trigger, started_at, finished_at, status, rows_affected, error_message, metadata)
    select 'http:' || p.fn_name,
           'cron',
           p.first_at,
           now(),
           case when p.failed > 0 then 'error' when p.unknown > 0 then 'degraded' else 'success' end,
           p.calls,
           case
             when p.failed > 0
               then p.failed || ' of ' || p.calls || ' calls returned non-2xx ' || coalesce(p.codes::text, '')
             when p.unknown > 0
               then p.unknown || ' of ' || p.calls || ' calls timed out or got no response'
                    || coalesce(': ' || left(p.last_error, 200), '')
           end,
           jsonb_build_object(
             'calls', p.calls, 'ok', p.ok, 'failed', p.failed, 'unknown', p.unknown,
             'status_codes', p.codes, 'source', 'mushi.edge_call_watchdog'
           )
      from per_fn p
     -- Failures always; a success heartbeat at most once an hour.
     where p.failed > 0
        or p.unknown > 0
        or not exists (
             select 1 from public.cron_runs cr
              where cr.job_name = 'http:' || p.fn_name
                and cr.started_at > now() - interval '1 hour'
           )
    returning 1
  ),
  marked as (
    update mushi.edge_function_calls c
       set checked_at = now()
      from due
     where c.request_id = due.request_id
    returning 1
  )
  select (select count(*) from ins) into v_rows
    from (select count(*) from marked) m;

  delete from mushi.edge_function_calls where called_at < now() - interval '3 days';
  return v_rows;
end;
$fn$;

revoke all on function mushi.edge_call_watchdog() from public, anon, authenticated;

-- ── 4. jobs ─────────────────────────────────────────────────────────────────
-- cron.schedule(name, …) replaces the job of that name (pg_cron >= 1.3).
select cron.schedule('mushi-agent-status-poll', '5-55/5 * * * *',
  $$select mushi.cron_http_post('agent-status-poll', '{}'::jsonb);$$);
select cron.schedule('mushi-backend-drift-scanner-daily', '5 3 * * *',
  $$select mushi.cron_http_post('backend-drift-scanner', '{}'::jsonb);$$);
select cron.schedule('mushi-intelligence-report-weekly', '0 6 * * 1',
  $$select mushi.cron_http_post('intelligence-report', jsonb_build_object('trigger', 'cron'));$$);
select cron.schedule('mushi-inventory-drift-watch', '24 * * * *',
  $$select mushi.cron_http_post('inventory-propose', jsonb_build_object('mode', 'drift_watch'), 30000);$$);
select cron.schedule('mushi-judge-batch-nightly', '14 3 * * *',
  $$select mushi.cron_http_post('judge-batch', jsonb_build_object('trigger', 'cron'));$$);
select cron.schedule('mushi-library-modernizer-weekly', '0 6 * * 0',
  $$select mushi.cron_http_post('library-modernizer', jsonb_build_object('mode', 'sweep'));$$);
select cron.schedule('mushi-prompt-auto-tune-weekly', '0 7 * * 0',
  $$select mushi.cron_http_post('prompt-auto-tune', jsonb_build_object('trigger', 'cron'));$$);
select cron.schedule('mushi-retention-sweep-daily', '27 3 * * *',
  $$select mushi.cron_http_post('retention-sweep', jsonb_build_object('trigger', 'cron'));$$);
select cron.schedule('mushi-sdk-versions-reconcile-daily', '30 2 * * *',
  $$select mushi.cron_http_post('sdk-versions-cron', '{}'::jsonb, 30000);$$);
select cron.schedule('mushi-sentry-seer-poll-15m', '8-53/15 * * * *',
  $$select mushi.cron_http_post('sentry-seer-poll', '{}'::jsonb);$$);
select cron.schedule('mushi-soc2-evidence', '30 4 * * *',
  $$select mushi.cron_http_post('soc2-evidence', jsonb_build_object('trigger', 'cron'));$$);
select cron.schedule('mushi-usage-aggregator-hourly', '9 * * * *',
  $$select mushi.cron_http_post('usage-aggregator', jsonb_build_object('trigger', 'cron'), 60000);$$);
select cron.schedule('pdca-qa-story-improve', '37 */6 * * *',
  $$select mushi.cron_http_post('pdca-runner', '{"mode":"qa_story_improve"}'::jsonb);$$);
select cron.schedule('recompute-tester-reputation', '0 2 * * *',
  $$select mushi.cron_http_post('recompute-tester-reputation', '{}'::jsonb);$$);
select cron.schedule('usage-alerts-hourly', '13 * * * *',
  $$select mushi.cron_http_post('usage-alerts', jsonb_build_object('trigger', 'cron'), 60000);$$);

select cron.schedule('mushi-reward-payout-aggregator', '0 9 1 * *',
  $$select mushi.cron_http_post('reward-payout-aggregator', '{}'::jsonb);$$);
select cron.alter_job(jobid, active := false)
  from cron.job
 where jobname = 'mushi-reward-payout-aggregator';

select cron.schedule('mushi-edge-call-watchdog', '*/10 * * * *',
  $$select mushi.edge_call_watchdog();$$);
