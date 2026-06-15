-- ============================================================================
-- 20260613120000_reporter_verify_reopen.sql
--
-- Closes the reporter two-way lifecycle loop:
--   fixed  + feedback_signal confirms  -> verified
--   fixed  + feedback_signal not_fixed -> linked child report (reopened)
--   reporter-initiated reopen          -> linked child report (reopened)
--
-- Idempotent: guarded DDL + dedup inside mushi_apply_reporter_feedback.
-- ============================================================================

-- Extend status CHECK with reporter-facing terminal states.
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_status_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_status_check CHECK (
    status IN (
      'new', 'pending', 'submitted', 'queued',
      'classified', 'grouped', 'fixing', 'fixed',
      'dismissed',
      'triaged', 'in_progress', 'resolved',
      'verified', 'reopened'
    )
  );

-- Regression / verification linkage columns.
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS parent_report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS regression_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_reports_parent_report_id
  ON public.reports(parent_report_id)
  WHERE parent_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_status_project
  ON public.reports(project_id, status, created_at DESC);

-- Extend feedback_signal enum with reporter "not fixed" chip.
ALTER TABLE public.report_comments
  DROP CONSTRAINT IF EXISTS report_comments_feedback_signal_check;

ALTER TABLE public.report_comments
  ADD CONSTRAINT report_comments_feedback_signal_check CHECK (
    feedback_signal IS NULL OR feedback_signal IN (
      'confirms',
      'wrong_target',
      'agent_fixed_wrong_thing',
      'already_fixed',
      'noise',
      'not_fixed'
    )
  );

COMMENT ON COLUMN public.reports.parent_report_id IS
  'When set, this report is a regression reopen spawned from the parent report.';
COMMENT ON COLUMN public.reports.verified_at IS
  'Timestamp when the original reporter confirmed the fix via feedback_signal=confirms.';
COMMENT ON COLUMN public.reports.regression_count IS
  'Number of times this report lineage has been reopened by the reporter.';

-- Idempotent feedback -> status transition. Returns jsonb outcome.
CREATE OR REPLACE FUNCTION public.mushi_apply_reporter_feedback(
  p_report_id uuid,
  p_signal text,
  p_reporter_token_hash text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.reports%ROWTYPE;
  v_child_id uuid;
BEGIN
  IF p_signal IS NULL OR p_signal NOT IN (
    'confirms', 'wrong_target', 'agent_fixed_wrong_thing', 'already_fixed', 'noise', 'not_fixed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SIGNAL');
  END IF;

  SELECT * INTO v_report
  FROM public.reports
  WHERE id = p_report_id
    AND reporter_token_hash = p_reporter_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  -- Dedup: idempotent on terminal outcomes, not on the comment row (API inserts comment after RPC).
  IF p_signal = 'confirms' AND v_report.status = 'verified' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_APPLIED', 'report_id', p_report_id, 'status', 'verified');
  END IF;

  IF p_signal IN ('not_fixed', 'wrong_target', 'agent_fixed_wrong_thing') THEN
    SELECT id INTO v_child_id
    FROM public.reports
    WHERE parent_report_id = p_report_id
      AND status IN ('reopened', 'new', 'triaged', 'in_progress', 'fixing')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_child_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'code', 'ALREADY_APPLIED',
        'report_id', p_report_id,
        'child_report_id', v_child_id,
        'status', 'reopened'
      );
    END IF;
  END IF;

  IF p_signal = 'confirms' AND v_report.status IN ('fixed', 'resolved') THEN
    UPDATE public.reports
    SET status = 'verified',
        verified_at = COALESCE(verified_at, now()),
        updated_at = now()
    WHERE id = p_report_id;

    RETURN jsonb_build_object(
      'ok', true,
      'code', 'VERIFIED',
      'report_id', p_report_id,
      'status', 'verified'
    );
  END IF;

  IF p_signal IN ('not_fixed', 'wrong_target', 'agent_fixed_wrong_thing')
     AND v_report.status IN ('fixed', 'resolved', 'verified') THEN
    -- Reuse an existing child reopen if one is already open for this parent.
    SELECT id INTO v_child_id
    FROM public.reports
    WHERE parent_report_id = p_report_id
      AND status IN ('reopened', 'new', 'triaged', 'in_progress', 'fixing')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_child_id IS NULL THEN
      INSERT INTO public.reports (
        project_id,
        category,
        description,
        summary,
        environment,
        reporter_token_hash,
        reporter_user_id,
        status,
        parent_report_id,
        reopened_at,
        app_version,
        custom_metadata
      )
      VALUES (
        v_report.project_id,
        v_report.category,
        COALESCE(NULLIF(trim(p_note), ''), v_report.description),
        COALESCE(v_report.summary, 'Regression reopen'),
        v_report.environment,
        p_reporter_token_hash,
        v_report.reporter_user_id,
        'reopened',
        p_report_id,
        now(),
        v_report.app_version,
        jsonb_build_object(
          'reopen_reason', p_signal,
          'reopened_from', p_report_id::text
        )
      )
      RETURNING id INTO v_child_id;

      UPDATE public.reports
      SET regression_count = regression_count + 1,
          status = CASE WHEN status = 'verified' THEN 'reopened' ELSE status END,
          reopened_at = COALESCE(reopened_at, now()),
          updated_at = now()
      WHERE id = p_report_id;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'code', 'REOPENED',
      'report_id', p_report_id,
      'child_report_id', v_child_id,
      'status', 'reopened'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'SIGNAL_RECORDED',
    'report_id', p_report_id,
    'status', v_report.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mushi_apply_reporter_feedback(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mushi_apply_reporter_feedback(uuid, text, text, text) TO service_role;

-- Flush PostgREST's in-memory schema + config cache so the new columns / RPC
-- are visible immediately after deploy (repo convention for structural migrations).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
