/**
 * FILE: packages/server/supabase/functions/_shared/gate-ids.ts
 * PURPOSE: Every gate the live `gate_runs_gate_check` constraint allows.
 *
 * Readers that need the newest run of each gate read it per gate from this
 * list, so an old run is never pushed out of a shared "newest N runs" page by
 * busier gates. gate-ids-parity.test.ts asserts it equals the constraint the
 * migrations build, so a new gate cannot be added without it.
 */
export const GATE_IDS = [
  'dead_handler',
  'mock_leak',
  'api_contract',
  'crawl',
  'status_claim',
  'spec_drift',
  'orphan_endpoint',
  'unknown_call',
  'schema_drift',
  'code_health',
  'design_drift',
  'ci_drift',
  'deploy_drift',
  'env_drift',
  'radar',
  'portfolio_radar',
  'portfolio_radar_ci',
  'store_review',
] as const
