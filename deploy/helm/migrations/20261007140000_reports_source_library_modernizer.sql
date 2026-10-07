-- ============================================================================
-- 20261007140000_reports_source_library_modernizer
--
-- ADDITIVE: apply BEFORE deploying the library-modernizer function.
-- library-modernizer files dependency-upgrade proposals as reports. It left
-- `source` unset, so the column default 'widget' showed a dependency bot as a
-- user's widget report (glot.it, 2026-10-07). It now sets
-- source = 'library_modernizer'; this allows that value.
--
-- Appends to the live list; never restates it (same as 20261006100200).
-- Existing modernizer reports keep 'widget'; relabelling them is a data
-- change for the owner, not part of this migration.
-- ============================================================================

DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['library_modernizer'];
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
  'Which inbox created the report: widget (SDK banner), sdk (programmatic), sentry (webhook), slack, voice (phone voice intake), api, linear, store_review (an App Store or Google Play review), ux_loop (a screen the mushi-ux loop flagged), library_modernizer (a dependency upgrade proposal).';
