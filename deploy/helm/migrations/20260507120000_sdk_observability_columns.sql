-- 2026-05-07 SDK observability boost: dedicated columns for the rich
-- breadcrumb / tag / sentry context surface that the web SDK started
-- shipping in this release. Until now we folded these into
-- `custom_metadata` (jsonb), which works for read-side ingest but
-- forces the admin /reports UI to traverse a free-form blob and makes
-- per-tag / per-trace filtering O(scan) on the dashboard.
--
-- Promoting them to first-class columns lets us:
--   - GIN-index breadcrumbs + tags so the admin can filter "all reports
--     where tags @> '{feature: checkout-v2}'" in one indexed lookup,
--   - btree-index sentry_trace_id + sentry_release for instant
--     correlation to Sentry distributed traces and release windows,
--   - back-fill historical reports cheaply by reading from
--     `custom_metadata` (the SDK has been writing the same structures
--     there for ~24h before this migration ships, so the back-fill
--     loses no signal),
--   - keep `custom_metadata` writable for future observability
--     surfaces without us having to ship a column for every one.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS breadcrumbs jsonb,
  ADD COLUMN IF NOT EXISTS tags jsonb,
  ADD COLUMN IF NOT EXISTS sentry_trace_id text,
  ADD COLUMN IF NOT EXISTS sentry_release text,
  ADD COLUMN IF NOT EXISTS sentry_environment text;

COMMENT ON COLUMN public.reports.breadcrumbs IS
  'SDK-side ring buffer (≤100 entries). Each entry: {timestamp, category, level, message, data?}. Mirrors Sentry breadcrumbs; auto-attached by the web SDK on every captureEvent / submitReport.';
COMMENT ON COLUMN public.reports.tags IS
  'Sticky scalar key/value tags from Mushi.setTag()/setTags(). Up to 64 keys; values are string|number|boolean. Indexed via GIN for "tags @> ''{k: v}''" filters.';
COMMENT ON COLUMN public.reports.sentry_trace_id IS
  'Sentry distributed-trace id captured at report time. Lets the admin correlate Mushi reports to the same trace as Sentry-side issues.';
COMMENT ON COLUMN public.reports.sentry_release IS
  'Sentry release / version string captured at report time (e.g. "checkout@1.4.0"). Useful for grouping reports by deploy.';
COMMENT ON COLUMN public.reports.sentry_environment IS
  'Sentry environment (production/staging/preview) captured at report time. Defaults to NULL when Sentry is not configured.';

-- ---------------------------------------------------------------------
-- Indexes. `IF NOT EXISTS` makes re-running the migration during local
-- dev (or restoring a staging branch) idempotent.
--
-- These are NOT concurrent index builds. Supabase wraps every
-- migration in a transaction, and `CREATE INDEX CONCURRENTLY` cannot
-- run inside one — so the build takes a normal ACCESS EXCLUSIVE lock
-- on the partition for the duration of the build. For `reports` (a
-- monthly partitioned table) the lock window is bounded to the
-- current partition, which has been acceptable historically. If a
-- future change here ever needs a truly non-blocking index build,
-- it must live in a separate migration file with the `--no-transaction`
-- directive and use `CREATE INDEX CONCURRENTLY` explicitly.
--
-- We deliberately use partial indexes on `IS NOT NULL` so the index
-- only stores rows that actually carry the field — most reports
-- today still have NULL here.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS reports_tags_gin
  ON public.reports USING gin (tags)
  WHERE tags IS NOT NULL;

CREATE INDEX IF NOT EXISTS reports_breadcrumbs_gin
  ON public.reports USING gin (breadcrumbs)
  WHERE breadcrumbs IS NOT NULL;

CREATE INDEX IF NOT EXISTS reports_sentry_trace_id_idx
  ON public.reports (sentry_trace_id)
  WHERE sentry_trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reports_sentry_release_idx
  ON public.reports (project_id, sentry_release)
  WHERE sentry_release IS NOT NULL;

-- ---------------------------------------------------------------------
-- Backfill — pull from `custom_metadata` for rows that were ingested
-- *after* the SDK boost shipped (`custom_metadata` carries
-- `breadcrumbs` / `tags` / `sentry.{traceId,release,environment}` since
-- 2026-05-06). Skip rows where the dedicated column is already
-- populated (re-running this migration must be idempotent).
--
-- Bound the back-fill to the last 30 days so we don't touch the long
-- archival tail; older reports rarely benefit from filterable tags
-- and the back-fill cost goes O(rows) on a 10M+ table.
-- ---------------------------------------------------------------------

UPDATE public.reports
SET
  breadcrumbs = COALESCE(
    breadcrumbs,
    CASE
      WHEN jsonb_typeof(custom_metadata -> 'breadcrumbs') = 'array'
        THEN custom_metadata -> 'breadcrumbs'
      ELSE NULL
    END
  ),
  tags = COALESCE(
    tags,
    CASE
      WHEN jsonb_typeof(custom_metadata -> 'tags') = 'object'
        THEN custom_metadata -> 'tags'
      ELSE NULL
    END
  ),
  sentry_trace_id = COALESCE(
    sentry_trace_id,
    NULLIF(custom_metadata #>> '{sentry,traceId}', '')
  ),
  sentry_release = COALESCE(
    sentry_release,
    NULLIF(custom_metadata #>> '{sentry,release}', '')
  ),
  sentry_environment = COALESCE(
    sentry_environment,
    NULLIF(custom_metadata #>> '{sentry,environment}', '')
  )
WHERE
  custom_metadata IS NOT NULL
  AND created_at > now() - interval '30 days'
  AND (
    breadcrumbs IS NULL
    OR tags IS NULL
    OR sentry_trace_id IS NULL
    OR sentry_release IS NULL
    OR sentry_environment IS NULL
  );
