/*
FILE: 20260616130000_backfill_tester_submission_points.sql
PURPOSE: Align historical tester_submissions.points_awarded with the bounty
         schedule and credit under-paid testers (idempotent).

OVERVIEW:
- Maps severity/submission_type → bounty action (mirrors severityToBountyAction)
- Resolves points from published_app_bounties or DEFAULT_BOUNTY_POINTS
- Pending rows: stamp-only correction (no balance change)
- Accepted/informative: update points_awarded + credit delta via award_tester_points
- Skips over-credit clawback (delta < 0) — manual review if needed

NOTES:
- Idempotency keys: backfill-points:{submission_id}
- Ledger reason: admin_grant (check constraint allow-list)
- Safe to re-run (ON CONFLICT on ledger idempotency_key)
*/

CREATE OR REPLACE FUNCTION private.tester_bounty_action(
  p_severity text,
  p_submission_type text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_submission_type, '')) = 'enhancement' THEN 'enhancement'
    WHEN lower(coalesce(p_severity, 'medium')) = 'critical' THEN 'bug_critical'
    WHEN lower(coalesce(p_severity, 'medium')) = 'high' THEN 'bug_high'
    WHEN lower(coalesce(p_severity, 'medium')) = 'low' THEN 'bug_low'
    ELSE 'bug_medium'
  END;
$$;

CREATE OR REPLACE FUNCTION private.lookup_bounty_points_sql(
  p_app_id uuid,
  p_action text
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT b.points_per_event
      FROM public.published_app_bounties b
      WHERE b.app_id = p_app_id
        AND b.action = p_action
        AND b.enabled IS DISTINCT FROM false
      LIMIT 1
    ),
    CASE p_action
      WHEN 'bug_critical' THEN 2500
      WHEN 'bug_high' THEN 1000
      WHEN 'bug_medium' THEN 500
      WHEN 'bug_low' THEN 100
      WHEN 'enhancement' THEN 50
      ELSE 50
    END
  );
$$;

DO $$
DECLARE
  r RECORD;
  v_action text;
  v_schedule_pts integer;
  v_expected integer;
  v_delta integer;
  v_old_points integer;
BEGIN
  FOR r IN
    SELECT
      ts.id,
      ts.tester_id,
      ts.app_id,
      ts.status,
      ts.severity,
      ts.submission_type,
      ts.points_awarded
    FROM public.tester_submissions ts
    WHERE ts.status IN ('accepted', 'informative', 'pending')
  LOOP
    v_action := private.tester_bounty_action(r.severity, r.submission_type);
    v_schedule_pts := private.lookup_bounty_points_sql(r.app_id, v_action);
    v_old_points := COALESCE(r.points_awarded, 0);

    IF r.status = 'accepted' THEN
      v_expected := v_schedule_pts;
    ELSIF r.status = 'informative' THEN
      v_expected := floor(v_schedule_pts * 0.5)::integer;
    ELSE
      v_expected := v_schedule_pts;
    END IF;

    IF v_old_points = v_expected THEN
      CONTINUE;
    END IF;

    UPDATE public.tester_submissions
       SET points_awarded = v_expected
     WHERE id = r.id;

    IF r.status IN ('accepted', 'informative') THEN
      v_delta := v_expected - v_old_points;
      IF v_delta > 0 THEN
        PERFORM public.award_tester_points(
          r.tester_id,
          v_delta,
          'admin_grant',
          r.id,
          r.app_id,
          'backfill-points:' || r.id::text
        );
      END IF;
    END IF;
  END LOOP;
END $$;
