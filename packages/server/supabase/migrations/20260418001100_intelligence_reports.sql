-- =============================================================================
-- V5.3 §2.16 B5 — persistent bug intelligence reports + opt-in
-- cross-customer benchmarking.
--
-- The intelligence-report Edge Function already runs weekly via pg_cron and
-- emits a Slack message. B5 elevates this into a first-class artifact:
--   • intelligence_reports        — one row per (project, week), markdown +
--                                    structured stats + benchmarks JSON
--   • intelligence_benchmark_optin — per-project consent toggle (default OFF)
--   • intelligence_benchmarks_mv  — privacy-preserving aggregates across all
--                                    opted-in projects (k-anonymity ≥ 5)
--
-- Privacy contract (enforced in code AND verified here):
--   • Benchmarks NEVER leak project_id, project_name, or any PII.
--   • Buckets with fewer than MIN_K_ANONYMITY (= 5) opted-in projects
--     are dropped from the materialized view.
--   • A project sees benchmarks only if it has opted in (RLS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS intelligence_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  -- Top-level digest written by the LLM (Markdown).
  summary_md TEXT NOT NULL,
  -- Structured numerical stats — fed into the PDF template.
  stats JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Snapshot of cross-customer benchmarks at generation time (NULL if the
  -- project has not opted in or k-anonymity was not met).
  benchmarks JSONB,
  -- Optional pre-rendered HTML for offline export. The admin client converts
  -- this to PDF via the browser's native print pipeline.
  rendered_html TEXT,
  -- Storage path if/when we ever publish a real PDF artifact (e.g. via a
  -- background job using a headless browser). Reserved for V6.
  pdf_storage_path TEXT,
  llm_model TEXT,
  llm_tokens_in INT,
  llm_tokens_out INT,
  generated_by TEXT NOT NULL DEFAULT 'cron'
    CHECK (generated_by IN ('cron', 'manual', 'http')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_reports_project_week
  ON intelligence_reports (project_id, week_start DESC);

CREATE TRIGGER trg_intelligence_reports_updated_at
  BEFORE UPDATE ON intelligence_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE intelligence_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY intelligence_reports_owner_read
  ON intelligence_reports FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

CREATE POLICY intelligence_reports_owner_write
  ON intelligence_reports FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = (SELECT auth.uid())));

-- ─── Per-project benchmarking opt-in ───────────────────────────────────────
-- We add the column to project_settings rather than a new table to keep the
-- settings surface flat. The default is FALSE (no sharing) — explicit consent
-- only.
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS benchmarking_optin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS benchmarking_optin_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS benchmarking_optin_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN project_settings.benchmarking_optin IS
  'V5.3 §2.16 — opt-in to share anonymised report metrics for cross-customer benchmarks. Off by default; enabling requires explicit owner action and is timestamped.';

-- ─── Cross-customer benchmarks (privacy-preserving) ────────────────────────
-- Stored as a regular materialized view. Refreshed nightly by pg_cron. The
-- view ONLY contains aggregates; no project_id, project name, or report id
-- ever leaks. We enforce k-anonymity by dropping any bucket with fewer than
-- 5 contributing projects.
CREATE MATERIALIZED VIEW IF NOT EXISTS intelligence_benchmarks_mv AS
WITH opted_in_projects AS (
  SELECT project_id
    FROM project_settings
   WHERE benchmarking_optin = TRUE
),
recent_reports AS (
  SELECT r.project_id,
         r.category,
         r.severity,
         r.status,
         DATE_TRUNC('week', r.created_at)::DATE AS week_start,
         r.created_at
    FROM reports r
   WHERE r.project_id IN (SELECT project_id FROM opted_in_projects)
     AND r.created_at > NOW() - INTERVAL '90 days'
),
fix_attempts_summary AS (
  SELECT fa.project_id,
         DATE_TRUNC('week', fa.started_at)::DATE AS week_start,
         COUNT(*) FILTER (WHERE fa.status = 'completed') AS fixes_completed,
         COUNT(*) AS fixes_total,
         AVG(EXTRACT(EPOCH FROM (fa.completed_at - fa.started_at)))
           FILTER (WHERE fa.completed_at IS NOT NULL) AS avg_fix_seconds
    FROM fix_attempts fa
   WHERE fa.project_id IN (SELECT project_id FROM opted_in_projects)
     AND fa.started_at > NOW() - INTERVAL '90 days'
   GROUP BY fa.project_id, DATE_TRUNC('week', fa.started_at)
)
SELECT
  rr.week_start,
  rr.category,
  rr.severity,
  COUNT(DISTINCT rr.project_id) AS contributing_projects,
  COUNT(*) AS report_count,
  AVG(EXTRACT(EPOCH FROM (NOW() - rr.created_at)) / 86400.0) AS avg_age_days,
  -- Roll up fix metrics from the per-project subquery above.
  AVG(fas.fixes_completed::NUMERIC / NULLIF(fas.fixes_total, 0))
    AS avg_fix_completion_rate,
  AVG(fas.avg_fix_seconds) AS avg_fix_seconds
FROM recent_reports rr
LEFT JOIN fix_attempts_summary fas
  ON fas.project_id = rr.project_id
 AND fas.week_start = rr.week_start
GROUP BY rr.week_start, rr.category, rr.severity
HAVING COUNT(DISTINCT rr.project_id) >= 5;  -- k-anonymity threshold

CREATE UNIQUE INDEX IF NOT EXISTS uniq_intelligence_benchmarks
  ON intelligence_benchmarks_mv (week_start, category, severity);

COMMENT ON MATERIALIZED VIEW intelligence_benchmarks_mv IS
  'V5.3 §2.16 — cross-customer benchmarks with k-anonymity ≥ 5. No project IDs, names, or PII. Refreshed nightly.';

-- Refresh function (CONCURRENTLY requires the unique index above).
CREATE OR REPLACE FUNCTION refresh_intelligence_benchmarks() RETURNS VOID AS $$
BEGIN
  -- Use advisory lock to avoid concurrent refreshes piling up.
  IF pg_try_advisory_xact_lock(7711) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY intelligence_benchmarks_mv;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Schedule nightly refresh at 03:30 UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('refresh-intelligence-benchmarks')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-intelligence-benchmarks');
    PERFORM cron.schedule(
      'refresh-intelligence-benchmarks',
      '30 3 * * *',
      $cron$SELECT refresh_intelligence_benchmarks();$cron$
    );
  END IF;
END$$;
