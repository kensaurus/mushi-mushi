-- ============================================================
-- SDK observability backfill polish — Copilot follow-up.
--
-- Two cosmetic + one perf concern called out by the Copilot review
-- on PR #91 against migration 20260507120000_sdk_observability_columns.sql
-- (already applied to prod, so amending in place would create
-- replay drift across self-hosters who already ran it). This
-- migration is a no-op on the prod database — every row that
-- could possibly carry the new columns has already been
-- back-filled — but it lands the corrected backfill *predicate*
-- for every fresh self-host environment that runs the migration
-- chain from scratch.
--
-- ── (1) "CONCURRENTLY-friendly" claim ──────────────────────────
--
-- The header of 20260507120000 said its indexes were
-- "CONCURRENTLY-friendly via CREATE INDEX IF NOT EXISTS". That's
-- misleading on two counts:
--
--   * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction,
--     and Supabase wraps every migration in a transaction, so the
--     CONCURRENTLY keyword would actually be rejected if we tried
--     to use it.
--
--   * `IF NOT EXISTS` only makes the create *idempotent*; it does
--     not lift the table-level write lock that a normal index
--     build takes.
--
-- For the SDK-observability columns the lock window is bounded
-- (the `reports` table is partitioned by month and only the
-- current partition gets touched, so the build is short), but a
-- comment that lies about behaviour is a future foot-gun. This
-- migration's only purpose for that issue is documentation — see
-- the canonical write-up above. A future "build a real concurrent
-- index" migration would need to live OUTSIDE the transaction
-- (separate migration file with `--no-transaction` directive) and
-- explicitly call `CREATE INDEX CONCURRENTLY`.
--
-- ── (2) Backfill scope was wider than necessary ────────────────
--
-- The original UPDATE matched any 30-day-old row where ANY of
-- the five new columns was NULL. Most rows have NULL values for
-- ALL five (legacy ingest path), so the planner picked an index
-- on `(created_at)` and rewrote ~every recent row even when
-- `custom_metadata` carried no source value to copy. On a
-- 10M-row reports table the rewrite was a multi-minute migration.
--
-- We tighten the predicate so each row is only rewritten when at
-- least one source value actually exists. The COALESCE bodies
-- already short-circuited on missing source paths, but Postgres
-- still wrote a tuple version per row — this version makes the
-- update genuinely targeted.
--
-- The query below is *idempotent* by construction:
--   - `breadcrumbs IS NULL AND jsonb_typeof(... 'breadcrumbs') = 'array'`
--     skips rows already populated by the prior migration AND rows
--     with no source data — both safe to skip.
--   - Each column's clause is OR'd, so a row with one new field
--     present (e.g. just sentry_release) only re-writes that
--     column, not the others.
-- ============================================================

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
    -- Only target rows where (a) the dedicated column is still NULL
    -- AND (b) custom_metadata actually carries a source value to
    -- copy. Every clause has the same shape so the planner can keep
    -- this on the (project_id, created_at) index without a seq scan.
    (breadcrumbs        IS NULL AND jsonb_typeof(custom_metadata -> 'breadcrumbs') = 'array')
    OR (tags            IS NULL AND jsonb_typeof(custom_metadata -> 'tags')        = 'object')
    OR (sentry_trace_id IS NULL AND NULLIF(custom_metadata #>> '{sentry,traceId}',     '') IS NOT NULL)
    OR (sentry_release  IS NULL AND NULLIF(custom_metadata #>> '{sentry,release}',     '') IS NOT NULL)
    OR (sentry_environment IS NULL AND NULLIF(custom_metadata #>> '{sentry,environment}', '') IS NOT NULL)
  );
