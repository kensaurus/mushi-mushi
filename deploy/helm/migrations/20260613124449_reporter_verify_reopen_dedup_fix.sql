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
      RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_APPLIED', 'report_id', p_report_id, 'child_report_id', v_child_id, 'status', 'reopened');
    END IF;
  END IF;

  IF p_signal = 'confirms' AND v_report.status IN ('fixed', 'resolved') THEN
    UPDATE public.reports SET status = 'verified', verified_at = COALESCE(verified_at, now()), updated_at = now() WHERE id = p_report_id;
    RETURN jsonb_build_object('ok', true, 'code', 'VERIFIED', 'report_id', p_report_id, 'status', 'verified');
  END IF;

  IF p_signal IN ('not_fixed', 'wrong_target', 'agent_fixed_wrong_thing') AND v_report.status IN ('fixed', 'resolved', 'verified') THEN
    INSERT INTO public.reports (project_id, category, description, summary, environment, reporter_token_hash, reporter_user_id, status, parent_report_id, reopened_at, app_version, custom_metadata)
    VALUES (v_report.project_id, v_report.category, COALESCE(NULLIF(trim(p_note), ''), v_report.description), COALESCE(v_report.summary, 'Regression reopen'), v_report.environment, p_reporter_token_hash, v_report.reporter_user_id, 'reopened', p_report_id, now(), v_report.app_version, jsonb_build_object('reopen_reason', p_signal, 'reopened_from', p_report_id::text))
    RETURNING id INTO v_child_id;

    UPDATE public.reports SET regression_count = regression_count + 1, status = CASE WHEN status = 'verified' THEN 'reopened' ELSE status END, reopened_at = COALESCE(reopened_at, now()), updated_at = now() WHERE id = p_report_id;

    RETURN jsonb_build_object('ok', true, 'code', 'REOPENED', 'report_id', p_report_id, 'child_report_id', v_child_id, 'status', 'reopened');
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'SIGNAL_RECORDED', 'report_id', p_report_id, 'status', v_report.status);
END;
$$;;
