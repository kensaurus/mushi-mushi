-- Rollback for 20261002120200_reporter_comments_fanout_v2.
-- Restores the 20260430000000 comment trigger body (in-app row only, no
-- fan-out) and removes the request-info RPC and the duplicate-follow trigger.

DROP TRIGGER IF EXISTS reports_follow_canonical_trigger ON public.reports;
DROP FUNCTION IF EXISTS public.reports_follow_canonical();
DROP FUNCTION IF EXISTS public.mushi_request_reporter_info(uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.report_comments_fanout_to_reporter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_report record;
BEGIN
  SELECT id, project_id, reporter_token_hash
  INTO target_report
  FROM public.reports
  WHERE id = NEW.report_id;

  IF target_report.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.author_kind = 'admin' AND NEW.visible_to_reporter IS TRUE THEN
    UPDATE public.reports
    SET last_admin_reply_at = now()
    WHERE id = NEW.report_id;

    INSERT INTO public.reporter_notifications(
      project_id, report_id, reporter_token_hash, notification_type, channel, payload, sent_at
    )
    VALUES (
      target_report.project_id,
      target_report.id,
      target_report.reporter_token_hash,
      'comment_reply',
      'in_app',
      jsonb_build_object(
        'reportId', target_report.id,
        'commentId', NEW.id,
        'message', left(NEW.body, 500)
      ),
      now()
    );
  ELSIF NEW.author_kind = 'reporter' THEN
    UPDATE public.reports
    SET last_reporter_reply_at = now()
    WHERE id = NEW.report_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_comments_fanout_to_reporter() FROM public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
