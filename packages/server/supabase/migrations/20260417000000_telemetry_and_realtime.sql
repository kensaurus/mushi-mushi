-- =============================================================================
-- Telemetry tables, realtime publication, and pg_cron schedules
-- =============================================================================
-- This migration adds first-class observability so the admin console can show
-- LLM health, cron job health, and anti-gaming events in real time. It also
-- wires up pg_cron schedules for previously-unscheduled background jobs, and
-- restores the projects(owner_id) index that was inadvertently removed in
-- 20260416700000_schema_hardening.sql.
--
-- Tables added:
--   * llm_invocations    — every LLM call with model, fallback, latency, tokens
--   * cron_runs          — every scheduled job execution with status/error
--   * anti_gaming_events — every flagging decision with reason and context
--
-- All three tables are project-scoped (where applicable), indexed for the admin
-- queries they back, RLS-protected to the project owner, and added to
-- supabase_realtime so subscribers receive live changes.
-- =============================================================================

-- Restore index removed during schema hardening — owner_id is queried on every
-- admin route to authorize the JWT user against their projects.
create index if not exists idx_projects_owner on projects(owner_id);

-- -----------------------------------------------------------------------------
-- Extensions: pg_cron + pg_net (both required for self-scheduling Edge calls).
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- llm_invocations — one row per LLM API call (Anthropic + OpenAI fallback)
-- -----------------------------------------------------------------------------
create table if not exists llm_invocations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references projects(id) on delete cascade,
  function_name   text not null,                          -- 'fast-filter' | 'classify-report' | 'judge-batch' | ...
  stage           text,                                   -- 'stage1' | 'stage2' | 'judge' | 'fix-suggestion' | ...
  report_id       uuid,
  primary_model   text not null,                          -- the model the function tried first
  used_model      text not null,                          -- the model that actually responded
  fallback_used   boolean not null default false,
  fallback_reason text,
  status          text not null default 'success',        -- 'success' | 'error' | 'timeout'
  error_message   text,
  latency_ms      integer,
  input_tokens    integer,
  output_tokens   integer,
  prompt_version  text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_llm_inv_project_created
  on llm_invocations (project_id, created_at desc);
create index if not exists idx_llm_inv_function_created
  on llm_invocations (function_name, created_at desc);
create index if not exists idx_llm_inv_fallback
  on llm_invocations (created_at desc) where fallback_used = true;
create index if not exists idx_llm_inv_status
  on llm_invocations (status, created_at desc) where status <> 'success';

alter table llm_invocations enable row level security;

-- Service role can insert any row; authenticated users can only read rows that
-- belong to a project they own. project_id is nullable for cross-project calls
-- (currently none), so those rows are never visible to non-service-role users.
drop policy if exists "service_role_writes_llm_invocations" on llm_invocations;
create policy "service_role_writes_llm_invocations"
  on llm_invocations for insert
  to service_role
  with check (true);

drop policy if exists "owner_reads_llm_invocations" on llm_invocations;
create policy "owner_reads_llm_invocations"
  on llm_invocations for select
  to authenticated
  using (
    project_id is not null
    and exists (
      select 1 from projects p
      where p.id = llm_invocations.project_id and p.owner_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- cron_runs — one row per scheduled job execution (or manual trigger)
-- -----------------------------------------------------------------------------
create table if not exists cron_runs (
  id            uuid primary key default gen_random_uuid(),
  job_name      text not null,                            -- 'judge-batch' | 'intelligence-report' | 'data-retention'
  trigger       text not null default 'cron',             -- 'cron' | 'manual' | 'http'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  status        text not null default 'running',          -- 'running' | 'success' | 'error'
  rows_affected integer,
  error_message text,
  metadata      jsonb default '{}'::jsonb
);

create index if not exists idx_cron_runs_job_started
  on cron_runs (job_name, started_at desc);
create index if not exists idx_cron_runs_status
  on cron_runs (status, started_at desc) where status <> 'success';

alter table cron_runs enable row level security;

-- cron_runs are global (no project_id) — only the service role and users that
-- own at least one project may read them. Reads happen exclusively through the
-- /v1/admin/health/cron endpoint which already requires a JWT and serves
-- cluster-wide health, so any project owner is allowed to read.
drop policy if exists "service_role_writes_cron_runs" on cron_runs;
create policy "service_role_writes_cron_runs"
  on cron_runs for all
  to service_role
  using (true) with check (true);

drop policy if exists "project_owners_read_cron_runs" on cron_runs;
create policy "project_owners_read_cron_runs"
  on cron_runs for select
  to authenticated
  using (
    exists (select 1 from projects p where p.owner_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- anti_gaming_events — one row per flagging decision (audit trail)
-- -----------------------------------------------------------------------------
create table if not exists anti_gaming_events (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  reporter_token_hash text not null,
  device_fingerprint  text,
  ip_address          text,
  user_agent          text,
  event_type          text not null,                       -- 'multi_account' | 'velocity_anomaly' | 'manual_flag' | 'unflag'
  reason              text,
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_ag_events_project_created
  on anti_gaming_events (project_id, created_at desc);
create index if not exists idx_ag_events_token
  on anti_gaming_events (reporter_token_hash, created_at desc);

alter table anti_gaming_events enable row level security;

drop policy if exists "service_role_writes_ag_events" on anti_gaming_events;
create policy "service_role_writes_ag_events"
  on anti_gaming_events for all
  to service_role
  using (true) with check (true);

drop policy if exists "owner_reads_ag_events" on anti_gaming_events;
create policy "owner_reads_ag_events"
  on anti_gaming_events for select
  to authenticated
  using (
    exists (
      select 1 from projects p
      where p.id = anti_gaming_events.project_id and p.owner_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Realtime publication — admin pages subscribe to these changes via supabase-js
-- -----------------------------------------------------------------------------
-- The supabase_realtime publication is created automatically by Supabase. We
-- add our tables idempotently. If the table is already a member, alter publication
-- raises an exception which we swallow.
do $$
begin
  begin
    alter publication supabase_realtime add table llm_invocations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table cron_runs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table anti_gaming_events;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table reporter_devices;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table reporter_notifications;
  exception when duplicate_object then null;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- pg_cron schedules — only registered if pg_cron schema is present.
--
-- judge-batch          : nightly LLM-as-judge eval pass
-- intelligence-report  : weekly digest generation
-- data-retention       : daily privacy/storage prune
-- -----------------------------------------------------------------------------
do $$
declare
  has_cron boolean;
begin
  select exists (select 1 from pg_namespace where nspname = 'cron') into has_cron;
  if not has_cron then
    raise notice 'pg_cron not installed; skipping schedule registration';
    return;
  end if;

  perform cron.unschedule(jobname)
  from cron.job
  where jobname in ('mushi-judge-batch-nightly', 'mushi-intelligence-report-weekly', 'mushi-data-retention-daily');

  perform cron.schedule(
    'mushi-judge-batch-nightly',
    '0 3 * * *',
    $cron$
      select net.http_post(
        url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/judge-batch',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body    := '{}'::jsonb
      );
    $cron$
  );

  perform cron.schedule(
    'mushi-intelligence-report-weekly',
    '0 6 * * 1',
    $cron$
      select net.http_post(
        url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/intelligence-report',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body    := '{}'::jsonb
      );
    $cron$
  );

  perform cron.schedule(
    'mushi-data-retention-daily',
    '0 4 * * *',
    $cron$
      with retention as (
        update reports
           set console_logs = null,
               network_logs = null,
               performance_metrics = null,
               screenshot_url = null,
               screenshot_path = null
         where created_at < now() - interval '90 days'
           and (console_logs is not null or network_logs is not null or screenshot_url is not null)
        returning 1
      ),
      pruned_edges as (
        delete from graph_edges
         where created_at < now() - interval '180 days'
        returning 1
      ),
      pruned_queue as (
        delete from processing_queue
         where created_at < now() - interval '30 days'
           and status in ('completed', 'dead_letter')
        returning 1
      )
      insert into cron_runs (job_name, trigger, finished_at, duration_ms, status, rows_affected, metadata)
      values (
        'data-retention',
        'cron',
        now(),
        0,
        'success',
        (select count(*)::int from retention) + (select count(*)::int from pruned_edges) + (select count(*)::int from pruned_queue),
        jsonb_build_object(
          'reports_scrubbed', (select count(*) from retention),
          'edges_pruned',     (select count(*) from pruned_edges),
          'queue_pruned',     (select count(*) from pruned_queue)
        )
      );
    $cron$
  );
end $$;
