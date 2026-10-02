-- ============================================================================
-- 20261002130100_recipe_gate_types
--
-- Plan 019 §5.1 migration 2 (Phase 1b). Adds the four recipe drift gates at
-- once: design_drift (written now, by the design-plane deviance check) and
-- ci_drift / deploy_drift / env_drift (Phase 2). Adding names a writer does not
-- use yet is harmless.
--
-- The list below is the live constraint read from pg_constraint on
-- 2026-10-02 (last extended by 20260612061520 with code_health), plus the
-- four new names. Every existing name is kept.
--
-- Verify after apply:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'gate_runs_gate_check';
-- ============================================================================

alter table public.gate_runs
  drop constraint if exists gate_runs_gate_check;

alter table public.gate_runs
  add constraint gate_runs_gate_check
  check (gate in (
    'dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim',
    'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift',
    'code_health',
    'design_drift', 'ci_drift', 'deploy_drift', 'env_drift'
  ));

comment on constraint gate_runs_gate_check on public.gate_runs is
  'Allowlist of valid gate discriminators. design_drift is written by the '
  'design-plane deviance check (Plan 019 Phase 1b); ci_drift, deploy_drift and '
  'env_drift are reserved for Phase 2. Last extended: 2026-10-02.';

notify pgrst, 'reload schema';
