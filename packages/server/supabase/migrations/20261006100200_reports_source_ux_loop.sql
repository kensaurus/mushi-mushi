-- ============================================================================
-- 20261006100200_reports_source_ux_loop
--
-- Plan 021 Phase 2. ADDITIVE: apply BEFORE deploying the api function.
-- A UX problem the mushi-ux loop found and could not fix, filed from the
-- console's "File as bug", is a report with source = 'ux_loop' (ADR 0004:
-- it lands in the normal bug queue).
--
-- Appends to the live list; never restates it (same as 20261003180100).
-- ============================================================================

DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['ux_loop'];
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

COMMENT ON COLUMN public.reports.source IS
  'Which inbox created the report: widget (SDK banner), sdk (programmatic), sentry (webhook), slack, voice (phone voice intake), api, linear, store_review (an App Store or Google Play review), ux_loop (a screen the mushi-ux loop flagged).';
