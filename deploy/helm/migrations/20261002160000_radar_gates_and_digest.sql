-- ============================================================================
-- 20261002160000_radar_gates_and_digest
--
-- Plan 020 Phase 1 (ADR 0017). ADDITIVE: apply BEFORE deploying the api,
-- radar-scan and operator-digest functions (they write these gate names and
-- read this table).
--
-- 1. gate_runs_gate_check gains the three radar gates:
--      radar         the scheduled hole checks (public probes + repo reads)
--      radar_ci      hole-check results pushed from the host's own CI
--      store_review  the on-demand store review checklist (Phase 2)
--    HAZARD: this re-creates the whole constraint. It keeps every live name
--    read from pg_constraint on 2026-10-02 (10 names) AND the four recipe
--    gates from 20261002130100_recipe_gate_types (not yet applied that day).
--    Apply it AFTER 20261002130100. If any other migration re-creates this
--    constraint later, it must carry these names too, or radar writes fail.
-- 2. operator_digest_settings: one row per organization, delivery OFF by
--    default. Member SELECT; writes only through the api (service role).
-- 3. Two crons: radar-scan daily 04:05 UTC (clear of 03:05 drift scanner and
--    03:35 recipe-collector) and operator-digest hourly at :20 (each org is
--    sent once a day, at its own send_hour_utc).
--
-- Verify after apply:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'gate_runs_gate_check';
--     -- expect 17 names incl. design_drift, radar, radar_ci, store_review
--   select relrowsecurity from pg_class where oid = 'public.operator_digest_settings'::regclass; -- t
--   select policyname, roles, cmd from pg_policies where tablename = 'operator_digest_settings';
--   select jobname, schedule from cron.job where jobname in ('mushi-radar-scan-daily','mushi-operator-digest-hourly');
--   -- then run each once and read the log:
--   select mushi.cron_http_post('radar-scan', '{"trigger":"manual"}'::jsonb, 60000);
--   select status, return_message from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'mushi-radar-scan-daily')
--    order by start_time desc limit 3;
-- ============================================================================

alter table public.gate_runs
  drop constraint if exists gate_runs_gate_check;

alter table public.gate_runs
  add constraint gate_runs_gate_check
  check (gate in (
    'dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim',
    'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift',
    'code_health',
    'design_drift', 'ci_drift', 'deploy_drift', 'env_drift',
    'radar', 'radar_ci', 'store_review'
  ));

comment on constraint gate_runs_gate_check on public.gate_runs is
  'Allowlist of valid gate discriminators. radar / radar_ci / store_review are the '
  'Plan 020 hole checks (ADR 0017). Last extended: 2026-10-02 (20261002160000).';

-- ── operator digest settings ─────────────────────────────────────────────────

create table if not exists public.operator_digest_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  -- Post to the Slack channel already connected on this project (its bot token).
  slack_project_id uuid references public.projects(id) on delete set null,
  email boolean not null default false,
  web_push boolean not null default false,
  send_hour_utc smallint not null default 0 check (send_hour_utc between 0 and 23),
  last_sent_at timestamptz,
  last_status text check (last_status is null or last_status in ('sent', 'partial', 'failed', 'nothing_to_send')),
  last_error text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.operator_digest_settings enable row level security;

drop policy if exists operator_digest_settings_member_select on public.operator_digest_settings;
create policy operator_digest_settings_member_select
  on public.operator_digest_settings for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists operator_digest_settings_service_write on public.operator_digest_settings;
create policy operator_digest_settings_service_write
  on public.operator_digest_settings for all
  to service_role
  using (true) with check (true);

revoke all on table public.operator_digest_settings from anon;
grant select on table public.operator_digest_settings to authenticated;

comment on table public.operator_digest_settings is
  'Plan 020 §9: the daily operator digest across an organization''s apps. Off by default. '
  'Written only by the api (owner/admin JWT) and the operator-digest function.';

-- ── crons ────────────────────────────────────────────────────────────────────

select cron.schedule('mushi-radar-scan-daily', '5 4 * * *',
  $$select mushi.cron_http_post('radar-scan', jsonb_build_object('trigger', 'cron'), 60000);$$);

select cron.schedule('mushi-operator-digest-hourly', '20 * * * *',
  $$select mushi.cron_http_post('operator-digest', jsonb_build_object('trigger', 'cron'), 60000);$$);
