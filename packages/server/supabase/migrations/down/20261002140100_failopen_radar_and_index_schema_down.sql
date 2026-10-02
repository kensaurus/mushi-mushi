-- Rollback for 20261002140100_failopen_radar_and_index_schema.
-- Undeploy the functions that write these first (integration-health-probe,
-- webhooks-github-indexer, codebase-analyze-worker, api), or their writes fail.
-- Radar gate runs are deleted because the narrowed CHECK would reject them.

DELETE FROM public.gate_findings
 WHERE gate_run_id IN (SELECT id FROM public.gate_runs WHERE gate = 'radar');
DELETE FROM public.gate_runs WHERE gate = 'radar';

-- Remove only 'radar', keeping whatever else other branches added.
DO $$
DECLARE
  v_def  text;
  v_vals text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.gate_runs'::regclass
     AND conname = 'gate_runs_gate_check';
  IF v_def IS NULL THEN
    RETURN;
  END IF;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF NOT ('radar' = ANY (v_vals)) THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.gate_runs DROP CONSTRAINT gate_runs_gate_check';
  EXECUTE format(
    'ALTER TABLE public.gate_runs ADD CONSTRAINT gate_runs_gate_check CHECK (gate IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM unnest(array_remove(v_vals, 'radar')) AS x)
  );
END $$;

ALTER TABLE public.project_codebase_files DROP COLUMN IF EXISTS imports;
ALTER TABLE public.project_repos
  DROP COLUMN IF EXISTS indexed_branch,
  DROP COLUMN IF EXISTS commit_sha;

NOTIFY pgrst, 'reload schema';
