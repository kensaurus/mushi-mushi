-- Rollback for 20261002160000_reporter_email_optin_caps.
-- Apply 20261002160100's down file first (it unschedules the digest cron).
-- Deferred deliveries are marked skipped first so the narrowed CHECK holds;
-- those emails are then never sent.

UPDATE public.notification_deliveries
   SET status = 'skipped', error_message = 'deferred_dropped_by_rollback'
 WHERE status = 'deferred'
    OR (status = 'pending' AND digest_run_id IS NOT NULL);

DROP INDEX IF EXISTS public.notification_deliveries_deferred_idx;
DROP INDEX IF EXISTS public.notification_deliveries_reporter_sent_idx;

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_check;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped'));

ALTER TABLE public.notification_deliveries
  DROP COLUMN IF EXISTS digest_run_id,
  DROP COLUMN IF EXISTS digest_claimed_at;

DROP INDEX IF EXISTS public.reporter_notification_prefs_verify_token_idx;
DROP INDEX IF EXISTS public.reporter_notification_prefs_unsubscribe_token_key;

ALTER TABLE public.reporter_notification_prefs
  DROP COLUMN IF EXISTS unsubscribe_token,
  DROP COLUMN IF EXISTS email_verify_sent_at;

NOTIFY pgrst, 'reload schema';
