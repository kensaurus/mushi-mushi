-- ============================================================================
-- 20261022010615_verified_fixes
--
-- Verified fixes (ADR 0035, Plan 024). Mushi merges a cloud agent's PR on its
-- own only when deterministic proof says the fix works: the Opus review says
-- merge, CI is green, a test fails without the fix and passes with it (the
-- host's `mushi-verify` workflow), no test was weakened, the diff is small,
-- and a second model family says merge. Every gate is evaluated against the
-- PR's head SHA and stored per head here. For 72 hours after a Mushi merge
-- the fix-verifier worker watches for regressions and can open a revert PR.
--
-- NAME: Plan 024 calls the per-head table `fix_verifications`, but that name
-- has been taken since 20260416300000 (Playwright verification results of
-- @mushi-mushi/verify, read by GET /v1/admin/verifications and NL query), so
-- this table is `fix_merge_gates`. The API shapes in the plan are unchanged.
--
-- ADDITIVE: ten project_settings columns (automatic merge OFF by default),
-- two tables (fix_merge_gates, fix_regressions), one fix_attempts column
-- (regressed_at), four appended fix_events.kind values, one cron job.
-- Apply BEFORE deploying fix-verifier, api and api-ext.
-- ============================================================================

-- ── Settings (Settings → Fixes → Verified merge) ────────────────────────────

-- Every item of a text[] is non-null and 1..max_len characters. IMMUTABLE so
-- CHECK constraints can call it (a CHECK cannot hold a subquery itself).
CREATE OR REPLACE FUNCTION private.text_items_within(arr text[], max_len integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(bool_and(x IS NOT NULL AND char_length(x) BETWEEN 1 AND max_len), true)
    FROM unnest(arr) AS x
$$;

REVOKE ALL ON FUNCTION private.text_items_within(text[], integer) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS verified_auto_merge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_auto_merge_daily_limit integer NOT NULL DEFAULT 5
    CONSTRAINT project_settings_verified_auto_merge_daily_limit_check
      CHECK (verified_auto_merge_daily_limit BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS verify_runs_on text[] NOT NULL DEFAULT '{ubuntu-latest}'
    -- 1..8 labels, each ^[A-Za-z0-9._-]{1,64}$. A label holds no comma, so
    -- the joined string is checked by one anchored pattern; array_position
    -- catches a NULL item, which array_to_string would skip.
    CONSTRAINT project_settings_verify_runs_on_check
      CHECK (
        cardinality(verify_runs_on) BETWEEN 1 AND 8
        AND array_position(verify_runs_on, NULL) IS NULL
        AND array_to_string(verify_runs_on, ',') ~ '^[A-Za-z0-9._-]{1,64}(,[A-Za-z0-9._-]{1,64})*$'
      ),
  ADD COLUMN IF NOT EXISTS verify_test_command text
    CONSTRAINT project_settings_verify_test_command_check
      CHECK (verify_test_command IS NULL OR (char_length(verify_test_command) BETWEEN 1 AND 300 AND position('{files}' IN verify_test_command) > 0)),
  ADD COLUMN IF NOT EXISTS verify_max_files integer NOT NULL DEFAULT 3
    CONSTRAINT project_settings_verify_max_files_check CHECK (verify_max_files BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS verify_max_lines integer NOT NULL DEFAULT 150
    CONSTRAINT project_settings_verify_max_lines_check CHECK (verify_max_lines BETWEEN 10 AND 1000),
  ADD COLUMN IF NOT EXISTS verify_protected_globs text[] NOT NULL DEFAULT '{}'
    CONSTRAINT project_settings_verify_protected_globs_check
      CHECK (cardinality(verify_protected_globs) <= 30 AND private.text_items_within(verify_protected_globs, 200)),
  ADD COLUMN IF NOT EXISTS verify_second_judge text NOT NULL DEFAULT 'auto'
    CONSTRAINT project_settings_verify_second_judge_check
      CHECK (verify_second_judge IN ('auto', 'openai', 'openrouter', 'off')),
  ADD COLUMN IF NOT EXISTS verify_second_judge_model text
    CONSTRAINT project_settings_verify_second_judge_model_check
      CHECK (verify_second_judge_model IS NULL OR char_length(verify_second_judge_model) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS auto_revert text NOT NULL DEFAULT 'pr'
    CONSTRAINT project_settings_auto_revert_check CHECK (auto_revert IN ('off', 'pr'));

COMMENT ON COLUMN public.project_settings.verified_auto_merge IS
  'Verified merge (ADR 0035): fix-verifier merges a cloud agent PR on its own when every gate passes on its head (Opus review merge, CI green, fail-to-pass proof, no weakened tests, diff budget, second-family review merge). Default false.';
COMMENT ON COLUMN public.project_settings.verified_auto_merge_daily_limit IS
  'Automatic verified merges per UTC day for this app (1-50, default 5).';
COMMENT ON COLUMN public.project_settings.verify_runs_on IS
  'runs-on labels written into the mushi-verify workflow (1-8 labels, each ^[A-Za-z0-9._-]{1,64}$). A self-hosted label moves the proof to the host''s own machine (ADR 0033).';
COMMENT ON COLUMN public.project_settings.verify_test_command IS
  'Test command for the mushi-verify workflow; {files} becomes the changed test files (at most 300 characters). NULL = the template''s example command.';
COMMENT ON COLUMN public.project_settings.verify_max_files IS
  'Diff budget: non-test source files an automatically merged PR may change (1-20, default 3).';
COMMENT ON COLUMN public.project_settings.verify_max_lines IS
  'Diff budget: changed non-test lines an automatically merged PR may have (10-1000, default 150).';
COMMENT ON COLUMN public.project_settings.verify_protected_globs IS
  'Extra paths an automatically merged PR must not touch (at most 30 globs, each at most 200 characters).';
COMMENT ON COLUMN public.project_settings.verify_second_judge IS
  'Second-family review: auto (OpenAI, then OpenRouter), openai, openrouter, or off. Always the project''s own key (ADR 0023/0031); never the platform key. Off or no key blocks automatic merge.';
COMMENT ON COLUMN public.project_settings.verify_second_judge_model IS
  'Model for the second review; NULL = gpt-5.4 (OpenAI) / openai/gpt-5.4 (OpenRouter).';
COMMENT ON COLUMN public.project_settings.auto_revert IS
  'After a Mushi merge regresses (default-branch CI fails on the merge commit, or the report reopens): pr opens a revert PR when no later commit touched the same files; off only flags the fix. A revert PR is never merged automatically.';

-- ── fix_attempts.regressed_at ───────────────────────────────────────────────

ALTER TABLE public.fix_attempts
  ADD COLUMN IF NOT EXISTS regressed_at timestamptz;

COMMENT ON COLUMN public.fix_attempts.regressed_at IS
  'Set by fix-verifier on the first ci_failed_on_merge or report_reopened signal after a Mushi merge (ADR 0035). The spend-down stop-loss counts it as a hold.';

-- ── fix_merge_gates: one row per (fix attempt, head SHA) ──────────────────

CREATE TABLE IF NOT EXISTS public.fix_merge_gates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_attempt_id     uuid NOT NULL REFERENCES public.fix_attempts(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id          uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  -- lowercased owner/name, as fix_reviews.repo.
  repo               text CHECK (repo IS NULL OR repo = lower(repo)),
  pr_number          integer CHECK (pr_number IS NULL OR pr_number > 0),
  head_sha           text NOT NULL CHECK (char_length(head_sha) BETWEEN 7 AND 64),
  base_sha           text,
  -- VerifyGate[] in evaluation order: review, ci, fail_to_pass, protected,
  -- budget, second_review (_shared/fix-verify.ts).
  gates              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(gates) = 'array'),
  -- Every gate status is 'pass'.
  passed             boolean NOT NULL DEFAULT false,
  -- {provider, model, verdict, findings[], summary, input_tokens,
  -- output_tokens, cost_usd, at}: model output from untrusted input.
  second_judge       jsonb,
  auto_merge_state   text NOT NULL DEFAULT 'none'
                       CHECK (auto_merge_state IN ('none', 'eligible', 'merged', 'skipped', 'failed')),
  auto_merge_detail  text,
  -- Set when this head was merged through Mushi (automatic or by a person):
  -- the regression watch reads merge_sha on the default branch.
  merged_at          timestamptz,
  merge_sha          text,
  -- The claim token of the fix-verifier run that owns the row; every write of
  -- a run is guarded on it, so a superseded run cannot overwrite.
  run_id             uuid,
  claimed_at         timestamptz,
  evaluated_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fix_merge_gates_once_per_head UNIQUE (fix_attempt_id, head_sha),
  CONSTRAINT fix_merge_gates_merged_has_sha CHECK (auto_merge_state <> 'merged' OR merged_at IS NOT NULL)
);

COMMENT ON TABLE public.fix_merge_gates IS
  'Verified fixes (ADR 0035): the merge gates of one fix attempt''s PR at one head SHA, the second-family review, the automatic merge outcome, and the merge commit Mushi made. Written by fix-verifier and the merge routes (service role); read by the console, the fix timeline and MCP get_fix_verification.';

CREATE INDEX IF NOT EXISTS idx_fix_merge_gates_attempt
  ON public.fix_merge_gates (fix_attempt_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_merge_gates_project
  ON public.fix_merge_gates (project_id, created_at DESC);
-- The daily automatic-merge cap and the 72-hour regression watch.
CREATE INDEX IF NOT EXISTS idx_fix_merge_gates_merged
  ON public.fix_merge_gates (project_id, merged_at DESC)
  WHERE merged_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fix_merge_gates_report
  ON public.fix_merge_gates (report_id)
  WHERE report_id IS NOT NULL;

-- ── fix_regressions: one row per signal after a Mushi merge ─────────────────

CREATE TABLE IF NOT EXISTS public.fix_regressions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_attempt_id   uuid NOT NULL REFERENCES public.fix_attempts(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  merge_sha        text NOT NULL,
  signal           text NOT NULL
                     CHECK (signal IN ('ci_failed_on_merge', 'report_reopened', 'new_report_in_changed_file')),
  detail           text,
  evidence         jsonb,
  revert_state     text NOT NULL DEFAULT 'none'
                     CHECK (revert_state IN ('none', 'pr_opened', 'not_safe', 'off', 'failed')),
  revert_pr_url    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fix_regressions_once_per_signal UNIQUE (fix_attempt_id, signal)
);

COMMENT ON TABLE public.fix_regressions IS
  'Regression signals in the 72 hours after a Mushi merge (ADR 0035): default-branch CI failed on the merge commit, the report reopened, or a new report''s stack names a changed file; and the revert PR, if any (never merged automatically). Written by fix-verifier (service role).';

CREATE INDEX IF NOT EXISTS idx_fix_regressions_project
  ON public.fix_regressions (project_id, created_at DESC);

-- ── RLS: project members read (the fix_reviews rule); service role writes ───

ALTER TABLE public.fix_merge_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fix_regressions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fix_merge_gates', 'fix_regressions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_member_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
           project_id IN (SELECT id FROM public.projects WHERE owner_id = (SELECT auth.uid()))
           OR private.is_project_member(project_id)
         )',
        t || '_member_select', t
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_service_write') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t || '_service_write', t
      );
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.fix_merge_gates FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.fix_merge_gates FROM authenticated;
GRANT SELECT ON TABLE public.fix_merge_gates TO authenticated;

REVOKE ALL ON TABLE public.fix_regressions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.fix_regressions FROM authenticated;
GRANT SELECT ON TABLE public.fix_regressions TO authenticated;

-- ── fix_events.kind: append verified / auto_merged / regressed / revert_opened ─
-- Read from the live constraint by name (as 20261021063310 does) so no value
-- is dropped. Added NOT VALID, then validated in the same transaction.
DO $$
DECLARE
  v_name text;
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['verified', 'auto_merged', 'regressed', 'revert_opened'];
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def
    FROM pg_constraint
   WHERE conrelid = 'public.fix_events'::regclass
     AND contype = 'c'
     AND conname = 'fix_events_kind_check';
  IF v_def IS NULL THEN
    SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def
      FROM pg_constraint
     WHERE conrelid = 'public.fix_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ~* '\mkind\M'
     LIMIT 1;
  END IF;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix_events kind check not found; refusing to guess the allowed kinds';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of %: %', v_name, v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.fix_events DROP CONSTRAINT %I', v_name);
  EXECUTE format(
    'ALTER TABLE public.fix_events ADD CONSTRAINT fix_events_kind_check CHECK (kind IN (%s)) NOT VALID',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
  EXECUTE 'ALTER TABLE public.fix_events VALIDATE CONSTRAINT fix_events_kind_check';
END $$;

-- ── Cron: every 10 minutes at :04, :14, …, :54 ──────────────────────────────
-- After agent-pr-review (3-53/10) has stored the verdicts, before
-- review-followup (6-56/10) and spend-down (8-58/10).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-fix-verifier schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-fix-verifier';

  PERFORM cron.schedule(
    'mushi-fix-verifier',
    '4-54/10 * * * *',
    $cron$select mushi.cron_http_post('fix-verifier', jsonb_build_object('trigger', 'cron'));$cron$
  );
END $$;
