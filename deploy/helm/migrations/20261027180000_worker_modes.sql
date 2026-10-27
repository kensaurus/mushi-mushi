-- ============================================================================
-- 20261027180000_worker_modes
--
-- Local worker modes (console ops plan P3; ADR 0049, ADR 0050, ADR 0042
-- amendment). A lane of `mushi work --daemon` (ADR 0048) did one thing: fix
-- reports (`fix`) or only review follow-ups (`followups`). Three more modes:
--
--   conflicts   resolve merge-queue conflicts on the machine (ADR 0049): the
--               lane claims a fix_merge_queue row while ADR 0041's cap of 2
--               conflict agents per PR (cloud and local together) is free,
--               merges the base into the PR head, lets the agent edit only
--               the conflicted files, and pushes a plain merge commit
--   audit       a code-read audit (ADR 0050): a model proposes findings for
--               one screen at a time, the worker reproduces each with a
--               deterministic check, and only reproduced findings are filed
--               (reports.source = 'code_audit', deduped in code_audit_keys)
--   skill       a skill run's rounds (ADR 0042) run on the lane instead of a
--               cloud agent: the round reports go into the lane's queue
--
-- Changes:
--   work_lanes        mode CHECK gains conflicts/audit/skill; review_model (the
--                     audit's optional veto model); repo (the owner/name of the
--                     lane's clone, sent by the daemon: a value, never a path)
--   work_claims       kind ('fix' | 'conflict' | 'audit'); report_id becomes
--                     nullable (only fix claims hold a report); merge_queue_id
--                     for conflict claims with its own one-active-claim index;
--                     outcome CHECK gains pushed/refused/filed; head_after
--   work_queue        source CHECK gains 'skill_run'
--   fix_merge_queue   local_claim_id: the conflict claim a local lane holds
--   skill_runs        lane_id: the run's rounds go to this lane, not the cloud
--   code_audit_keys   one row per (app, file + rule + evidence hash): the
--                     unique constraint that makes audit filing dedupe race-proof
--   reports.source    appends 'code_audit' to the live list
--
-- Every CHECK below is replaced by finding the live constraint by a value only
-- it lists, and the migration stops when it is not there: a constraint left in
-- place would refuse the new values and the routes would fail quietly.
--
-- ADDITIVE (new columns are nullable or defaulted, CHECKs only widen). Apply
-- BEFORE deploying api-ext, merge-queue, skill-runs and spend-down-worker.
-- Older daemons drop a lane whose mode they do not know (it stays idle).
-- ============================================================================

-- Replace one CHECK constraint, found by a literal only it contains.
CREATE OR REPLACE FUNCTION pg_temp.replace_check(p_table regclass, p_marker text, p_name text, p_def text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_con record;
  v_found int := 0;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = p_table AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%' || p_marker || '%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table, v_con.conname);
    v_found := v_found + 1;
  END LOOP;
  IF v_found = 0 THEN
    RAISE EXCEPTION 'no CHECK on % lists %; refusing to guess', p_table, p_marker;
  END IF;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%s)', p_table, p_name, p_def);
END $$;

-- ── work_lanes ──────────────────────────────────────────────────────────────
SELECT pg_temp.replace_check(
  'public.work_lanes', '''followups''', 'work_lanes_mode_check',
  $$mode IN ('fix', 'followups', 'conflicts', 'audit', 'skill')$$
);

ALTER TABLE public.work_lanes
  ADD COLUMN IF NOT EXISTS review_model text
    CHECK (review_model IS NULL OR review_model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  ADD COLUMN IF NOT EXISTS repo text
    CHECK (repo IS NULL OR repo ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$');

COMMENT ON COLUMN public.work_lanes.review_model IS
  'Audit lanes (ADR 0050): a second model that may only veto a reproduced finding, never confirm one. NULL = no veto pass. Sent in the audit claim, not in the heartbeat answer.';
COMMENT ON COLUMN public.work_lanes.repo IS
  'owner/name of the lane''s clone, as the daemon reads it from its origin remote. Conflict claims (ADR 0049) offer only this repository''s PRs. A value, never a path.';

-- ── work_claims ─────────────────────────────────────────────────────────────
ALTER TABLE public.work_claims
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'fix',
  ADD COLUMN IF NOT EXISTS merge_queue_id uuid REFERENCES public.fix_merge_queue(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS head_after text CHECK (head_after IS NULL OR head_after ~ '^[0-9a-f]{40}$');

ALTER TABLE public.work_claims ALTER COLUMN report_id DROP NOT NULL;

ALTER TABLE public.work_claims DROP CONSTRAINT IF EXISTS work_claims_kind_target;
ALTER TABLE public.work_claims
  ADD CONSTRAINT work_claims_kind_target CHECK (
    (kind = 'fix' AND report_id IS NOT NULL AND merge_queue_id IS NULL)
    OR (kind = 'conflict' AND report_id IS NULL AND merge_queue_id IS NOT NULL)
    OR (kind = 'audit' AND report_id IS NULL AND merge_queue_id IS NULL)
  );

SELECT pg_temp.replace_check(
  'public.work_claims', '''pr_opened''', 'work_claims_outcome_check',
  $$outcome IS NULL OR outcome IN ('pr_opened', 'no_change', 'verdict', 'timeout', 'skipped', 'stopped', 'failed', 'lease_expired', 'pushed', 'refused', 'filed')$$
);

COMMENT ON COLUMN public.work_claims.kind IS
  'fix: a report (report_id; the lease every dispatcher reads). conflict: a fix_merge_queue row (merge_queue_id, ADR 0049). audit: one screen of a code-read audit (ADR 0050), no target row.';
COMMENT ON COLUMN public.work_claims.head_after IS
  'Conflict claims: the merge commit the worker pushed.';

-- One local conflict agent per queue row at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_claims_active_queue_row
  ON public.work_claims (merge_queue_id)
  WHERE status = 'active' AND merge_queue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_claims_queue_row_recent
  ON public.work_claims (merge_queue_id, claimed_at DESC)
  WHERE merge_queue_id IS NOT NULL;

-- ── work_queue ──────────────────────────────────────────────────────────────
SELECT pg_temp.replace_check(
  'public.work_queue', '''report_file''', 'work_queue_source_check',
  $$source IN ('console', 'report_file', 'requeue', 'lease_expired', 'skill_run')$$
);

-- Spend-down and fix lanes skip a report queued for another lane: look it up by report.
CREATE INDEX IF NOT EXISTS idx_work_queue_report
  ON public.work_queue (report_id);

-- ── fix_merge_queue ─────────────────────────────────────────────────────────
ALTER TABLE public.fix_merge_queue
  ADD COLUMN IF NOT EXISTS local_claim_id uuid REFERENCES public.work_claims(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fix_merge_queue.local_claim_id IS
  'A local worker lane holds this conflict (ADR 0049). The cloud conflict agent and the release train leave the row alone while it is set; counted in conflict_agents like a cloud run.';

-- ── skill_runs ──────────────────────────────────────────────────────────────
ALTER TABLE public.skill_runs
  ADD COLUMN IF NOT EXISTS lane_id uuid REFERENCES public.work_lanes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.skill_runs.lane_id IS
  'ADR 0042 amendment: the run''s round reports go into this local worker lane''s queue instead of to a cloud agent. NULL = cloud (spend-down).';

-- ── code_audit_keys ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.code_audit_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- file + rule + sha256 of the evidence line, computed by the server.
  audit_key     text NOT NULL CHECK (char_length(audit_key) BETWEEN 1 AND 500),
  file          text NOT NULL CHECK (char_length(file) BETWEEN 1 AND 300),
  rule          text NOT NULL CHECK (rule ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  line          integer NOT NULL CHECK (line >= 1),
  -- The report this key filed; NULL once the report is deleted.
  report_id     uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  lane_id       uuid REFERENCES public.work_lanes(id) ON DELETE SET NULL,
  -- When the key last filed a report (the audit's hourly cap counts these).
  filed_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT code_audit_keys_project_key_unique UNIQUE (project_id, audit_key)
);

COMMENT ON TABLE public.code_audit_keys IS
  'Code-read audit findings already filed (ADR 0050): one row per app and file + rule + evidence hash. The unique constraint makes filing race-proof: an open or dismissed report is never filed again; a fixed one may be, when the same evidence is still in the code. Service role only.';

CREATE INDEX IF NOT EXISTS idx_code_audit_keys_project_filed
  ON public.code_audit_keys (project_id, filed_at DESC);

ALTER TABLE public.code_audit_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS code_audit_keys_service_all ON public.code_audit_keys;
CREATE POLICY code_audit_keys_service_all ON public.code_audit_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.code_audit_keys FROM anon, authenticated;

-- ── reports.source: append 'code_audit' to the live list ────────────────────
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['code_audit'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass
     AND conname = 'reports_source_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reports_source_check not found; refusing to guess the allowed sources';
  END IF;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of reports_source_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.reports DROP CONSTRAINT reports_source_check';
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;
