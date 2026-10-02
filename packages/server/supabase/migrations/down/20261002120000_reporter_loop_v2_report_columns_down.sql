-- Rollback for 20261002120000_reporter_loop_v2_report_columns.
-- Drops duplicate follows and the reporter-loop report columns. Closed
-- reasons, shipped versions and "waiting on you" state are lost.

DROP TABLE IF EXISTS public.reporter_report_follows;

DROP INDEX IF EXISTS public.reports_awaiting_reporter_idx;
DROP INDEX IF EXISTS public.reports_fixed_release_id_idx;

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_closed_reason_check;

ALTER TABLE public.reports
  DROP COLUMN IF EXISTS closed_reason,
  DROP COLUMN IF EXISTS fixed_in_version,
  DROP COLUMN IF EXISTS fixed_release_id,
  DROP COLUMN IF EXISTS admin_seen_at,
  DROP COLUMN IF EXISTS awaiting_reporter_at;

NOTIFY pgrst, 'reload schema';
