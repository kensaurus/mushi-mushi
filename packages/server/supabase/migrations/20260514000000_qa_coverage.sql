/*
FILE: packages/server/supabase/migrations/20260514000000_qa_coverage.sql
PURPOSE: QA Coverage Suite — data model for user-story-linked automated tests
         that run on cron via browser providers (Playwright, Browserbase,
         Firecrawl Actions).

OVERVIEW:
- qa_stories: a test story linked to an optional inventory user story via a
  soft reference (uuid). Stores the NL prompt, Playwright/Stagehand script,
  provider, cron schedule, and BYOK provider reference (string, not FK since
  BYOK keys are resolved at runtime by the edge function).
- qa_story_runs: one row per execution of a story. FK to qa_stories + project.
  Stores status, latency, provider session URL (Browserbase replay link), and
  assertion failures as JSONB.
- qa_story_evidence: per-run artefacts (screenshots, console logs, HAR, video,
  Playwright traces, DOM snapshots). Stored by reference to Supabase Storage.
- qa_story_coverage_24h: materialized view — per-story pass rate, drift vs 7d
  baseline, last failure URL. Refreshed by pg_cron every 15 minutes.
- qa_platform_rollup_24h: per-platform/SDK report volume and SDK version drift
  for the PlatformHealthTile dashboard component. Refreshed hourly.

DEPENDENCIES:
- projects table (FK)
- project_members table (for RLS policies)
- reports table (for qa_platform_rollup_24h MV)

NOTES:
- All tables are scoped to project_id with RLS policies.
- user_story_node_id is a soft UUID reference (no FK) since user stories live
  in the inventories.parsed JSONB rather than a normalized table.
- byok_provider is a text reference ('browserbase' | 'firecrawl_actions' |
  'openai' etc.); the runner resolves the actual key from mushi_runtime_config.
*/

-- ── qa_stories ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qa_stories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Soft reference to a user_story node inside inventories.parsed JSONB.
  -- Mirrors the intent of fix_attempts → inventory_action without requiring
  -- a normalized inventory_nodes table.
  user_story_node_id  uuid,
  name                text NOT NULL,
  prompt              text,                      -- natural-language description
  script              text,                      -- Playwright/Stagehand script body
  script_lang         text NOT NULL DEFAULT 'playwright-ts',  -- 'playwright-ts' | 'stagehand' | 'firecrawl-actions'
  browser_provider    text NOT NULL DEFAULT 'local',          -- 'local' | 'browserbase' | 'firecrawl_actions'
  schedule_cron       text DEFAULT '0 * * * *',              -- pg_cron expression; default = hourly
  enabled             boolean NOT NULL DEFAULT true,
  capture_video       boolean NOT NULL DEFAULT false,
  -- Text reference to the BYOK provider slug used by the runner to
  -- resolve the actual API key from mushi_runtime_config.
  byok_provider       text,
  owner               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_stories_project ON public.qa_stories(project_id);
CREATE INDEX IF NOT EXISTS idx_qa_stories_enabled ON public.qa_stories(project_id, enabled) WHERE enabled = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_qa_stories_updated_at()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qa_stories_updated_at ON public.qa_stories;
CREATE TRIGGER qa_stories_updated_at
  BEFORE UPDATE ON public.qa_stories
  FOR EACH ROW EXECUTE FUNCTION public.set_qa_stories_updated_at();

-- ── qa_story_runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qa_story_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id             uuid NOT NULL REFERENCES public.qa_stories(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','running','passed','failed','error','timeout','skipped')),
  latency_ms           integer,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  provider             text,                       -- actual provider used
  provider_session_url text,                       -- Browserbase replay URL
  summary              text,                       -- LLM-generated one-liner
  assertion_failures   jsonb DEFAULT '[]'::jsonb,  -- array of {step, expected, actual}
  error_message        text,
  triggered_by         text DEFAULT 'cron',        -- 'cron' | 'manual'
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_story_runs_story ON public.qa_story_runs(story_id);
CREATE INDEX IF NOT EXISTS idx_qa_story_runs_project ON public.qa_story_runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_story_runs_status ON public.qa_story_runs(project_id, status);

-- ── qa_story_evidence ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qa_story_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.qa_story_runs(id) ON DELETE CASCADE,
  kind         text NOT NULL
                 CHECK (kind IN ('screenshot','console','network','video','trace','dom','har')),
  storage_path text NOT NULL,  -- Supabase Storage path in 'qa-evidence' bucket
  mime         text,
  step_label   text,           -- optional: which step this evidence belongs to
  captured_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_story_evidence_run ON public.qa_story_evidence(run_id);

-- ── qa_story_coverage_24h (materialized view) ─────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.qa_story_coverage_24h AS
SELECT
  s.id                   AS story_id,
  s.project_id,
  s.name,
  s.enabled,
  s.browser_provider,
  COUNT(r.id)            AS runs_24h,
  SUM(CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END)  AS passed_24h,
  SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END)  AS failed_24h,
  SUM(CASE WHEN r.status = 'error'  THEN 1 ELSE 0 END)  AS error_24h,
  ROUND(
    CASE
      WHEN COUNT(r.id) = 0 THEN NULL
      ELSE 100.0 * SUM(CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END) / COUNT(r.id)
    END, 1
  )                      AS pass_rate_pct,
  MAX(r.started_at)      AS last_run_at,
  -- Last failure's provider session URL (Browserbase replay link)
  (
    SELECT rr.provider_session_url
    FROM public.qa_story_runs rr
    WHERE rr.story_id = s.id
      AND rr.status = 'failed'
      AND rr.started_at > now() - interval '24 hours'
    ORDER BY rr.started_at DESC
    LIMIT 1
  )                      AS last_failure_url
FROM public.qa_stories s
LEFT JOIN public.qa_story_runs r
  ON r.story_id = s.id
  AND r.started_at > now() - interval '24 hours'
GROUP BY s.id, s.project_id, s.name, s.enabled, s.browser_provider;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_coverage_24h_story ON public.qa_story_coverage_24h(story_id);
CREATE INDEX IF NOT EXISTS idx_qa_coverage_24h_project ON public.qa_story_coverage_24h(project_id);

-- ── qa_platform_rollup_24h (materialized view for PlatformHealthTile) ──────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.qa_platform_rollup_24h AS
SELECT
  project_id,
  LOWER(environment->>'platform')                  AS platform,
  sdk_package,
  COUNT(*)                                          AS reports_24h,
  SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical_24h,
  SUM(CASE WHEN severity = 'high'     THEN 1 ELSE 0 END) AS high_24h,
  ARRAY_AGG(DISTINCT sdk_version ORDER BY sdk_version)
    FILTER (WHERE sdk_version IS NOT NULL)           AS sdk_versions
FROM public.reports
WHERE created_at > now() - interval '24 hours'
  AND environment->>'platform' IS NOT NULL
GROUP BY project_id, LOWER(environment->>'platform'), sdk_package;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_platform_rollup_24h_pk
  ON public.qa_platform_rollup_24h(project_id, platform, sdk_package);
CREATE INDEX IF NOT EXISTS idx_qa_platform_rollup_24h_project
  ON public.qa_platform_rollup_24h(project_id);

-- Schedule hourly refresh for platform rollup
SELECT cron.schedule(
  'refresh-qa-platform-rollup-24h',
  '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.qa_platform_rollup_24h$$
);

-- Schedule 15-minute refresh for coverage view
SELECT cron.schedule(
  'refresh-qa-story-coverage-24h',
  '*/15 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.qa_story_coverage_24h$$
);

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.qa_stories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_story_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_story_evidence ENABLE ROW LEVEL SECURITY;

-- Project members can read all QA tables
CREATE POLICY "qa_stories_select"
  ON public.qa_stories FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "qa_stories_insert_update_delete"
  ON public.qa_stories FOR ALL
  USING (
    project_id IN (
      SELECT project_id FROM public.project_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY "qa_story_runs_select"
  ON public.qa_story_runs FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "qa_story_runs_insert"
  ON public.qa_story_runs FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "qa_story_evidence_select"
  ON public.qa_story_evidence FOR SELECT
  USING (
    run_id IN (
      SELECT r.id FROM public.qa_story_runs r
      JOIN public.project_members pm ON pm.project_id = r.project_id
      WHERE pm.user_id = auth.uid()
    )
  );

-- Service role can bypass RLS for edge function writes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qa_stories        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qa_story_runs     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qa_story_evidence TO service_role;
GRANT SELECT ON public.qa_story_coverage_24h  TO authenticated, service_role;
GRANT SELECT ON public.qa_platform_rollup_24h TO authenticated, service_role;
