-- Rollback for 20261002120100_reporter_notifications_v2.
-- Restoring UNIQUE (report_id, notification_type, channel) fails if keyed
-- deliveries (one per comment / follower / release) share a triple; resolve
-- those rows by hand first — this file never deletes data.
-- Held and discarded notifications become visible again once the status
-- column is gone; release or remove them in the Outbox before rolling back.

ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_report_id_notification_type_channel_key
  UNIQUE (report_id, notification_type, channel);

DROP INDEX IF EXISTS public.notification_deliveries_dedupe_uidx;

ALTER TABLE public.notification_deliveries
  DROP COLUMN IF EXISTS dedupe_key;

DROP INDEX IF EXISTS public.reporter_notifications_held_idx;
DROP INDEX IF EXISTS public.reporter_notifications_dedupe_uidx;

ALTER TABLE public.reporter_notifications
  DROP CONSTRAINT IF EXISTS reporter_notifications_type_check,
  DROP CONSTRAINT IF EXISTS reporter_notifications_status_check;

ALTER TABLE public.reporter_notifications
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS body_override,
  DROP COLUMN IF EXISTS released_by,
  DROP COLUMN IF EXISTS released_at,
  DROP COLUMN IF EXISTS dedupe_key;

NOTIFY pgrst, 'reload schema';
