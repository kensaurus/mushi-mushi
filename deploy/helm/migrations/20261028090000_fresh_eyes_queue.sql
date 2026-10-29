-- ============================================================================
-- 20261028090000_fresh_eyes_queue
--
-- "Run now" for the first-time user test (fresh-eyes runs, ADR 0053
-- amendment 2026-10-28; BL-138 for fresh-eyes). The console queues a run and a
-- local worker (`mushi work --daemon`, ADR 0048) takes it and runs
-- `mushi-ux fresh-eyes` on its own machine, so a person never types a command.
--
--   ux_runs        status gains 'queued'. A queued fresh-eyes row is the
--                  request: requested_by, sessions_requested, success_text,
--                  and detail (why a run failed or stopped, in plain words).
--                  account_granted_by / account_grant_until: an operator's
--                  single-use, short grant to mint synthetic accounts when a
--                  worker of that same operator claims the run (Mushi's own
--                  project only). No password is ever stored: accounts are
--                  minted at claim time and returned once in the claim answer.
--                  claim_id: the work_claims row running it.
--   work_claims    kind 'fresh_eyes' with ux_run_id (one active claim per
--                  run); outcome gains 'ran' (the run finished and synced)
--   work_hosts     takes: the extra claim kinds the daemon says it can run
--                  ('fresh_eyes'); an older daemon sends none and is never
--                  offered one
--
-- Every CHECK below is replaced by finding the live constraint by a value only
-- it lists, and the migration stops when it is not there.
--
-- ADDITIVE (new nullable or defaulted columns; CHECKs only widen; the
-- kind/target CHECK keeps every existing row valid). Apply BEFORE deploying
-- api-ext and api.
--
-- Verify after apply:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'ux_runs_status_check';      -- lists queued
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'work_claims_kind_target';   -- has fresh_eyes
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'work_claims_outcome_check'; -- lists ran
--   select column_name from information_schema.columns
--    where table_name = 'work_hosts' and column_name = 'takes';                                       -- takes
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

-- ── ux_runs ─────────────────────────────────────────────────────────────────
SELECT pg_temp.replace_check(
  'public.ux_runs', '''stopped''', 'ux_runs_status_check',
  $$status IN ('queued', 'running', 'done', 'failed', 'stopped')$$
);

ALTER TABLE public.ux_runs
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sessions_requested integer CHECK (sessions_requested IS NULL OR sessions_requested BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS success_text text CHECK (success_text IS NULL OR char_length(success_text) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS detail text CHECK (detail IS NULL OR char_length(detail) <= 1000),
  ADD COLUMN IF NOT EXISTS account_granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_grant_until timestamptz;

COMMENT ON COLUMN public.ux_runs.requested_by IS
  'Fresh-eyes runs queued from the console (ADR 0053 amendment 2026-10-28): who pressed Run now. NULL for runs started in a terminal.';
COMMENT ON COLUMN public.ux_runs.detail IS
  'Why a queued or worker-run fresh-eyes run failed or stopped, in plain words (shown in the console). Never a password or a key.';
COMMENT ON COLUMN public.ux_runs.account_granted_by IS
  'An operator allowed this queued run to sign up with synthetic accounts (Mushi''s own project only). Single use: cleared when a worker of that same operator claims the run, which mints the accounts then. No password is stored.';

-- Queued runs a worker may take, oldest first.
CREATE INDEX IF NOT EXISTS ux_runs_fresh_eyes_queued
  ON public.ux_runs (project_id, started_at)
  WHERE kind = 'fresh_eyes' AND status = 'queued';

-- ── work_claims ─────────────────────────────────────────────────────────────
ALTER TABLE public.work_claims
  ADD COLUMN IF NOT EXISTS ux_run_id uuid REFERENCES public.ux_runs(id) ON DELETE CASCADE;

ALTER TABLE public.work_claims DROP CONSTRAINT IF EXISTS work_claims_kind_target;
ALTER TABLE public.work_claims
  ADD CONSTRAINT work_claims_kind_target CHECK (
    (kind = 'fix' AND report_id IS NOT NULL AND merge_queue_id IS NULL AND ux_run_id IS NULL)
    OR (kind = 'conflict' AND report_id IS NULL AND merge_queue_id IS NOT NULL AND ux_run_id IS NULL)
    OR (kind = 'audit' AND report_id IS NULL AND merge_queue_id IS NULL AND ux_run_id IS NULL)
    OR (kind = 'fresh_eyes' AND report_id IS NULL AND merge_queue_id IS NULL AND ux_run_id IS NOT NULL)
  );

SELECT pg_temp.replace_check(
  'public.work_claims', '''pr_opened''', 'work_claims_outcome_check',
  $$outcome IS NULL OR outcome IN ('pr_opened', 'no_change', 'verdict', 'timeout', 'skipped', 'stopped', 'failed', 'lease_expired', 'pushed', 'refused', 'filed', 'ran')$$
);

COMMENT ON COLUMN public.work_claims.ux_run_id IS
  'fresh_eyes claims: the queued ux_runs row the worker runs (ADR 0053 amendment 2026-10-28).';

-- One worker per queued run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_claims_active_ux_run
  ON public.work_claims (ux_run_id)
  WHERE status = 'active' AND ux_run_id IS NOT NULL;

ALTER TABLE public.ux_runs
  ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES public.work_claims(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ux_runs.claim_id IS
  'The local worker claim that ran this fresh-eyes run, when a worker ran it.';

-- ── work_hosts ──────────────────────────────────────────────────────────────
ALTER TABLE public.work_hosts
  ADD COLUMN IF NOT EXISTS takes text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (takes <@ ARRAY['fresh_eyes']::text[]);

COMMENT ON COLUMN public.work_hosts.takes IS
  'Claim kinds beyond its lanes'' modes the daemon says it can run, from a closed list (fresh_eyes). A daemon that predates the list sends none and is never offered such a claim.';
