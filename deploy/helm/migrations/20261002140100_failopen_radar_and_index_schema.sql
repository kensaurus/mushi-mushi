-- ============================================================================
-- 20261002140100_failopen_radar_and_index_schema
--
-- ADDITIVE — apply BEFORE deploying integration-health-probe,
-- webhooks-github-indexer, codebase-analyze-worker and api. Those functions
-- write the new gate value and columns; deployed first, every write fails.
--
-- Plan 020 Phase 0 (fail-open fixes, branch fix/failopen-2026-10).
--
-- 1. gate_runs.gate gains 'radar': Mushi's own setup checks
--    (byok_key_invalid, spend_cap_unset, webhook_never_delivered,
--    index_branch_mismatch, index_stale), written once a day per project by
--    integration-health-probe (_shared/radar.ts).
--
-- 2. project_repos.commit_sha / indexed_branch. The indexer has written
--    `commit_sha` since June and codebase-impact-resolve / the analyze runner
--    read it, but the column never existed: every write failed unchecked, and
--    impact-resolve answered "No connected GitHub repo" because its select
--    errored. `indexed_branch` records which branch the last index read, for
--    the index_branch_mismatch check.
--
-- 3. project_codebase_files.imports: relative import specifiers extracted
--    from the WHOLE file at index time. The graph builder used to regex a
--    600-character preview of symbol-less rows only, so files with symbols
--    lost every import edge.
--
-- Verification (run after applying):
--   select pg_get_constraintdef(oid) like '%''radar''%' as radar_ok
--     from pg_constraint where conname = 'gate_runs_gate_check';
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public'
--      and ((table_name = 'project_repos' and column_name in ('commit_sha', 'indexed_branch'))
--        or (table_name = 'project_codebase_files' and column_name = 'imports'));
--   -- expect radar_ok = true and three rows (text, text, ARRAY).
-- ============================================================================

ALTER TABLE public.gate_runs
  DROP CONSTRAINT IF EXISTS gate_runs_gate_check;

ALTER TABLE public.gate_runs
  ADD CONSTRAINT gate_runs_gate_check
  CHECK (gate IN (
    'dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim',
    'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift',
    'code_health', 'radar'
  ));

COMMENT ON CONSTRAINT gate_runs_gate_check ON public.gate_runs IS
  'Allowlist of valid gate discriminators. radar is written daily by '
  'integration-health-probe with Mushi''s own setup checks (_shared/radar.ts). '
  'Last extended: 2026-10-02.';

ALTER TABLE public.project_repos
  ADD COLUMN IF NOT EXISTS commit_sha text,
  ADD COLUMN IF NOT EXISTS indexed_branch text;

COMMENT ON COLUMN public.project_repos.commit_sha IS
  'Head commit of the default branch the code index was last built from.';
COMMENT ON COLUMN public.project_repos.indexed_branch IS
  'Branch the last index sweep or push actually read; compared with GitHub''s default branch by the radar.';

ALTER TABLE public.project_codebase_files
  ADD COLUMN IF NOT EXISTS imports text[];

COMMENT ON COLUMN public.project_codebase_files.imports IS
  'Relative import specifiers of the whole file (same list on each chunk of the file). Feeds graph import edges.';

-- 4. The monthly LLM budget is now enforced on the shared LLM path
--    (_shared/llm-budget.ts); it used to be display-only.
COMMENT ON COLUMN public.project_settings.monthly_llm_budget_usd IS
  'Monthly LLM budget in USD. Enforced: once this UTC month''s llm_invocations spend (BYOK and platform key alike) reaches it, generation calls stop with llm_budget_exceeded until the 1st. NULL = no budget.';

NOTIFY pgrst, 'reload schema';
