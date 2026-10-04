-- Sort reports by how bad they are, not alphabetically.
--
-- reports.severity is text, so `ORDER BY severity DESC` gave medium, low,
-- high, critical: the console's Severity sort and the dogfood banner's
-- "Open the worst" put the least urgent bugs on top (2026-10-04 console
-- audit, group B #74). GET /v1/admin/reports now orders `sort=severity` by
-- this column (_shared/report-list-filters.ts REPORT_SORT_COLUMNS).
--
-- Deploy order: apply this migration BEFORE deploying the `api` edge
-- function, or `sort=severity` fails with an unknown-column error.
--
-- Additive and idempotent. The CHECK on severity allows only these four
-- values or NULL; anything else (and NULL) ranks NULL, which the list sorts
-- last in both directions.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS severity_rank smallint
  GENERATED ALWAYS AS (
    CASE severity
      WHEN 'critical' THEN 4
      WHEN 'high' THEN 3
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 1
      ELSE NULL
    END
  ) STORED;

COMMENT ON COLUMN public.reports.severity_rank IS
  'critical=4, high=3, medium=2, low=1, else NULL. Sort key for the console Severity column.';

CREATE INDEX IF NOT EXISTS idx_reports_project_severity_rank
  ON public.reports (project_id, severity_rank DESC NULLS LAST, created_at DESC);
