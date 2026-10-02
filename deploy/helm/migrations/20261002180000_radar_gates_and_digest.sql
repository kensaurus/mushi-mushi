-- ============================================================================
-- 20261002180000_radar_gates_and_digest
--
-- Plan 020 Phase 1 (ADR 0017). ADDITIVE: apply BEFORE deploying the api,
-- radar-scan and operator-digest functions (they write these gate names and
-- read this table).
--
-- 1. gate_runs_gate_check gains three gates:
--      portfolio_radar     the scheduled app hole checks (public probes, repo reads, connectors)
--      portfolio_radar_ci  app hole-check results pushed from the host's own CI
--      store_review        the on-demand store review checklist (Phase 2)
--    `radar` belongs to T1 (Mushi's own setup checks, 20261002140100); these
--    names keep the two producers apart. The values are appended to whatever
--    the constraint allows NOW (read from pg_get_constraintdef, the same
--    pattern as 20261002140100), so no other branch's gate is dropped. It
--    raises instead of guessing if the constraint cannot be read.
-- 2. operator_digest_settings: one row per organization, delivery OFF by
--    default. Member SELECT; writes only through the api (service role).
-- 3. Two crons: radar-scan daily 04:05 UTC (clear of 03:05 drift scanner and
--    03:35 recipe-collector) and operator-digest hourly at :20 (each org is
--    sent once a day, at its own send_hour_utc).
--
-- Verify after apply:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'gate_runs_gate_check';
--     -- every name it allowed before (compare before and after) plus
--     -- portfolio_radar, portfolio_radar_ci and store_review
--   select relrowsecurity from pg_class where oid = 'public.operator_digest_settings'::regclass; -- t
--   select policyname, roles, cmd from pg_policies where tablename = 'operator_digest_settings';
--   select jobname, schedule from cron.job where jobname in ('mushi-radar-scan-daily','mushi-operator-digest-hourly');
--   -- then run each once and read the log:
--   select mushi.cron_http_post('radar-scan', '{"trigger":"manual"}'::jsonb, 60000);
--   select status, return_message from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'mushi-radar-scan-daily')
--    order by start_time desc limit 3;
-- ============================================================================

-- Append to the live list; never restate it (see 20261002140100).
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['portfolio_radar', 'portfolio_radar_ci', 'store_review'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.gate_runs'::regclass
     AND conname = 'gate_runs_gate_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'gate_runs_gate_check not found; refusing to guess the allowed gates';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of gate_runs_gate_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.gate_runs DROP CONSTRAINT gate_runs_gate_check';
  EXECUTE format(
    'ALTER TABLE public.gate_runs ADD CONSTRAINT gate_runs_gate_check CHECK (gate IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

COMMENT ON CONSTRAINT gate_runs_gate_check ON public.gate_runs IS
  'Allowlist of valid gate discriminators. portfolio_radar / portfolio_radar_ci / store_review '
  'are the Plan 020 app hole checks (ADR 0017); radar is Mushi''s own setup checks (T1). '
  'Extend it by reading the current values (see 20261002140100), not by restating a list. '
  'Last extended: 2026-10-02.';

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
