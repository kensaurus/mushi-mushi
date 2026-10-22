-- Library modernization findings can be 'resolved' (Plan: burndown enablers).
--
-- A finding whose linked report was fixed stayed 'pending' (13 on
-- 2026-10-22), so the console kept offering to dispatch work that was done.
-- `reconcileFixedFindings` (_shared/modernization-dispatch-db.ts) now marks
-- such findings 'resolved' on every console read and every library-modernizer
-- run. It is idempotent and only touches findings that are still open, so no
-- data backfill lives here: this migration only widens the status CHECK.
--
-- Until it is applied, the reconcile update is refused by the CHECK; the
-- callers log that and carry on (non-fatal).

ALTER TABLE public.modernization_findings
  DROP CONSTRAINT IF EXISTS modernization_findings_status_check;

ALTER TABLE public.modernization_findings
  ADD CONSTRAINT modernization_findings_status_check
  CHECK (status IN ('pending', 'dispatched', 'dismissed', 'resolved'));

COMMENT ON COLUMN public.modernization_findings.status IS
  'pending → dispatched (a fix was sent) → resolved (its report was fixed); or dismissed by a person.';
