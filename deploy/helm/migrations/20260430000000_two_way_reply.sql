-- Two-way reporter/developer conversation support.

ALTER TABLE public.report_comments
  ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'admin'
    CHECK (author_kind IN ('admin', 'reporter')),
  ADD COLUMN IF NOT EXISTS reporter_token_hash text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS last_admin_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reporter_reply_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_comments_author_well_formed'
  ) THEN
    ALTER TABLE public.report_comments
      ADD CONSTRAINT report_comments_author_well_formed CHECK (
        (author_kind = 'admin' AND author_user_id IS NOT NULL AND reporter_token_hash IS NULL)
        OR
        (author_kind = 'reporter' AND author_user_id IS NULL AND reporter_token_hash IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS report_comments_reporter_idx
  ON public.report_comments (report_id, reporter_token_hash)
  WHERE author_kind = 'reporter';

CREATE INDEX IF NOT EXISTS reports_reporter_history_idx
  ON public.reports (project_id, reporter_token_hash, created_at DESC);

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
      project_id,
      report_id,
      reporter_token_hash,
      notification_type,
      channel,
      payload,
      sent_at
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

DROP TRIGGER IF EXISTS report_comments_fanout_to_reporter_trigger ON public.report_comments;
CREATE TRIGGER report_comments_fanout_to_reporter_trigger
AFTER INSERT ON public.report_comments
FOR EACH ROW
EXECUTE FUNCTION public.report_comments_fanout_to_reporter();

-- Force PostgREST to drop its in-memory schema cache so the new columns and
-- the new trigger are visible to API callers immediately. Adding the columns
-- to `reports` mid-day risks the same Sentry MUSHI-MUSHI-SERVER-N stale-cache
-- window that bit the retention sweep on 2026-04-29.
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
