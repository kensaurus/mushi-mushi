-- A report Mushi's own check filed can be closed as a false alarm: the check
-- was wrong. The console offers that reason only for site_audit, site_watch
-- and security_advisory, and the reporter is not told.
--
-- Appends to the live check, the same way reports_source_check grows, so a
-- reason added by an earlier migration is kept.

DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['false_alarm'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass
     AND conname = 'reports_closed_reason_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reports_closed_reason_check not found; refusing to guess the allowed reasons';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of reports_closed_reason_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.reports DROP CONSTRAINT reports_closed_reason_check';
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_closed_reason_check CHECK (closed_reason IS NULL OR closed_reason IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;
