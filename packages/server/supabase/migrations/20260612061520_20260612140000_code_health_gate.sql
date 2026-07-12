-- Migration: 20260612140000_code_health_gate
--
-- Extends gate_runs.gate CHECK constraint to include 'code_health', a new
-- gate type written by the CI-push ingest endpoint when a host app reports
-- bundle sizes and god-file findings.
--
-- No new tables: metric_series (already exists, indexed) stores bundle-size
-- time-series data; gate_runs + gate_findings (already exist) store the
-- per-CI-push code-health gate run and its per-file findings.
--
-- Verification: after applying, insert a throwaway gate_runs row with
-- gate='code_health' as service_role, then delete it. If it succeeds the
-- constraint is live.

-- ── Extend gate CHECK constraint ─────────────────────────────────────────────

ALTER TABLE public.gate_runs
  DROP CONSTRAINT IF EXISTS gate_runs_gate_check;

ALTER TABLE public.gate_runs
  ADD CONSTRAINT gate_runs_gate_check
  CHECK (gate IN (
    'dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim',
    'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift',
    'code_health'
  ));

COMMENT ON CONSTRAINT gate_runs_gate_check ON public.gate_runs IS
  'Allowlist of valid gate discriminators. code_health is written by the '
  'POST /v1/ingest/metrics CI-push endpoint when a host app reports '
  'bundle sizes and god-file LOC findings. Last extended: 2026-06-12.';

-- ── Notify PostgREST ─────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
