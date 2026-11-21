-- =============================================================================
-- 20261121190000_ux_scorecard
--
-- ADR 0067: the UX scorecard. ADDITIVE and idempotent: apply BEFORE deploying
-- the api-ext function.
--
--   ux_runs.kind 'scorecard'        one scorecard run of an app (mushi-ux scorecard)
--   ux_surfaces.score / scorecard / facts
--                                   one scored page: the overall 1–10, the eight
--                                   rubric scores with issues and claims, and the
--                                   facts it was scored on. The page's trend is
--                                   its score across runs (project_id, path).
--   reports.source 'ux_scorecard'   a root cause the scorecard filed; one open
--                                   report per (app, pattern_key), like
--                                   code_audit (ADR 0065)
--   project_settings.ux_scorecard_viewport
--                                   the viewport an app is scored at
--                                   (desktop-first, '1440x900' by default)
-- =============================================================================

-- ── ux_runs.kind: add 'scorecard' ───────────────────────────────────────────
ALTER TABLE public.ux_runs DROP CONSTRAINT IF EXISTS ux_runs_kind_check;
ALTER TABLE public.ux_runs
  ADD CONSTRAINT ux_runs_kind_check CHECK (kind = ANY (ARRAY['loop'::text, 'fresh_eyes'::text, 'scorecard'::text]));

-- ── ux_surfaces: a scored page ──────────────────────────────────────────────
ALTER TABLE public.ux_surfaces
  ADD COLUMN IF NOT EXISTS score smallint
    CHECK (score IS NULL OR score BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS scorecard jsonb
    CHECK (scorecard IS NULL OR (jsonb_typeof(scorecard) = 'object' AND pg_column_size(scorecard) <= 65536)),
  ADD COLUMN IF NOT EXISTS facts jsonb
    CHECK (facts IS NULL OR (jsonb_typeof(facts) = 'object' AND pg_column_size(facts) <= 65536));

COMMENT ON COLUMN public.ux_surfaces.score IS
  'ADR 0067: a scorecard page''s overall score, 1–10, computed from its eight rubric scores (_shared/ux-scorecard.ts overallScore). NULL for UX loop screens and unscored pages.';
COMMENT ON COLUMN public.ux_surfaces.scorecard IS
  'ADR 0067: the page''s scores, issues (with evidence and a fix) and claims, as parsePageAnswer returns them.';
COMMENT ON COLUMN public.ux_surfaces.facts IS
  'ADR 0067: what the page was scored on: tab title, headings, visible text (trimmed), controls, settle time, axe counts, viewport.';

-- The trend: one page's score across the app's runs.
CREATE INDEX IF NOT EXISTS ux_surfaces_project_path_scored
  ON public.ux_surfaces (project_id, path, updated_at DESC)
  WHERE score IS NOT NULL;

-- ── reports.source: append 'ux_scorecard' to the live list ───────────────────
-- Same append-only pattern as 20261006100200 (ux_loop).
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['ux_scorecard'];
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

-- One open report per root cause; the race between two runs is settled here.
CREATE UNIQUE INDEX IF NOT EXISTS reports_ux_scorecard_open_pattern_uniq
  ON public.reports (project_id, pattern_key)
  WHERE source = 'ux_scorecard'
    AND pattern_key IS NOT NULL
    AND parent_report_id IS NULL
    AND status IN ('new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened', 'fixing', 'in_progress');

-- ── project_settings: the viewport an app is scored at ──────────────────────
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS ux_scorecard_viewport text NOT NULL DEFAULT '1440x900'
    CHECK (ux_scorecard_viewport ~ '^[0-9]{3,4}x[0-9]{3,4}$');

COMMENT ON COLUMN public.project_settings.ux_scorecard_viewport IS
  'ADR 0067: WIDTHxHEIGHT the UX scorecard scores this app at. Desktop-first by default (console apps); a phone-first app sets 390x844.';
