-- Phase 1: story_map_runs table + inventory_proposals.source column
-- story_map_runs tracks each "map from live app" crawl job.

CREATE TABLE IF NOT EXISTS public.story_map_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','completed','failed')),
  base_url           text NOT NULL,
  max_pages          int NOT NULL DEFAULT 20,
  provider           text NOT NULL DEFAULT 'firecrawl'
                       CHECK (provider IN ('firecrawl', 'browserbase')),
  pages_crawled      int,
  pages_discovered   int,
  error_message      text,
  proposal_id        uuid,  -- set once the inventory_proposals row is created
  cursor_pr_url      text,  -- set if Cursor Cloud agent opened a refinement PR
  crawl_summary      jsonb DEFAULT '{}'::jsonb,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  triggered_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.story_map_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY story_map_runs_project_member ON public.story_map_runs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = story_map_runs.project_id
        AND pm.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = story_map_runs.project_id
        AND p.owner_id = (SELECT auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_story_map_runs_project ON public.story_map_runs(project_id, started_at DESC);

-- Add source column to inventory_proposals if it doesn't exist
ALTER TABLE public.inventory_proposals
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'passive_discovery'
    CHECK (source IN ('passive_discovery', 'live_crawl', 'manual'));

-- Add qa_coverage_enabled flag to inventory_proposals for opt-in TDD generation
ALTER TABLE public.inventory_proposals
  ADD COLUMN IF NOT EXISTS qa_coverage_enabled boolean DEFAULT false;

-- Flush PostgREST's schema/config caches so the new table + the new
-- inventory_proposals column are visible to API callers immediately after
-- deploy (repo convention for structural migrations).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
