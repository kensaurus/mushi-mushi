-- Rollback for 20261002120300_reporter_prefs_push_settings.
-- Apply down files in reverse order: 120300, 120200, 120100, 120000.
-- Drops the review-mode setting and template overrides; the console Outbox
-- then has nothing to read, and every pipeline message is sent at once.

ALTER TABLE public.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_reporter_updates_mode_check;

ALTER TABLE public.project_settings
  DROP COLUMN IF EXISTS reporter_updates_mode,
  DROP COLUMN IF EXISTS reporter_templates,
  DROP COLUMN IF EXISTS reporter_email_enabled,
  DROP COLUMN IF EXISTS reporter_push_enabled;

DROP INDEX IF EXISTS public.reporter_notification_prefs_end_user_idx;

ALTER TABLE public.reporter_notification_prefs
  DROP COLUMN IF EXISTS email_verified_at,
  DROP COLUMN IF EXISTS email_verify_token_hash,
  DROP COLUMN IF EXISTS unsubscribed_at,
  DROP COLUMN IF EXISTS end_user_id;

NOTIFY pgrst, 'reload schema';
