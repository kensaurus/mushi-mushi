-- Rollback for 20261002140100_failopen_radar_and_index_schema.
-- Undeploy the functions that write these first (integration-health-probe,
-- webhooks-github-indexer, codebase-analyze-worker, api), or their writes fail.
-- Radar gate runs are deleted because the narrowed CHECK would reject them.

DELETE FROM public.gate_findings
 WHERE gate_run_id IN (SELECT id FROM public.gate_runs WHERE gate = 'radar');
DELETE FROM public.gate_runs WHERE gate = 'radar';

ALTER TABLE public.gate_runs
  DROP CONSTRAINT IF EXISTS gate_runs_gate_check;
ALTER TABLE public.gate_runs
  ADD CONSTRAINT gate_runs_gate_check
  CHECK (gate IN (
    'dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim',
    'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift',
    'code_health'
  ));

ALTER TABLE public.project_codebase_files DROP COLUMN IF EXISTS imports;
ALTER TABLE public.project_repos
  DROP COLUMN IF EXISTS indexed_branch,
  DROP COLUMN IF EXISTS commit_sha;

NOTIFY pgrst, 'reload schema';
