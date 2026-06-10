-- Migration: content_quality_issues
-- Generic, project-scoped table for AI content quality reports from any
-- integrated project (e.g. glot.it). Each row represents one content asset
-- that needs review/regeneration.
--
-- Also adds regen_webhook_url + regen_webhook_secret to project_settings so
-- the console can dispatch regeneration back to the source project.
--
-- Objects are schema-qualified with `public.` throughout — relying on
-- search_path inside migrations is brittle and diverges from repo convention.

-- ── 1. project_settings: add regen webhook config ────────────────────────────
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS regen_webhook_url text,
  ADD COLUMN IF NOT EXISTS regen_webhook_secret text;

-- ── 2. content_quality_issues ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_quality_issues (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid    NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Asset identity (from source project)
  content_ref         text    NOT NULL,  -- source project's content_version_id or key
  content_type        text    NOT NULL,  -- mnemonic / lesson_story / grammar_lesson / etc.
  content_key         text    NOT NULL DEFAULT '',

  -- Quality signals
  reason              text    NOT NULL CHECK (reason IN (
                        'low_judge_score','user_flag','low_star_rating','high_downvote_ratio')),
  judge_score         numeric(5,4),
  avg_star            numeric(4,2),
  downvote_ratio      numeric(5,4),
  flag_count          integer NOT NULL DEFAULT 0,

  -- Observability
  langfuse_trace_id   text,
  source_deeplink     text,
  feedback_summary    jsonb,            -- glot_get_content_feedback_summary output

  -- Lifecycle
  status              text    NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','in_review','regenerating','resolved','dismissed')),
  regen_status        text             CHECK (regen_status IN ('queued','running','completed','failed')),
  regen_requested_at  timestamptz,
  regen_completed_at  timestamptz,
  regen_result        jsonb,            -- response from glot-regenerate-content

  source              text,             -- 'glot.it' or other
  source_description  text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cqi_project_status
  ON public.content_quality_issues(project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cqi_project_reason
  ON public.content_quality_issues(project_id, reason);

-- Idempotency: one open issue per (project, content_ref, reason)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cqi_idempotent
  ON public.content_quality_issues(project_id, content_ref, reason)
  WHERE status = 'open';

ALTER TABLE public.content_quality_issues ENABLE ROW LEVEL SECURITY;

-- RLS: project members/owners only
CREATE POLICY "cqi_select_member" ON public.content_quality_issues
  FOR SELECT
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
      UNION
      SELECT p.id FROM public.projects p WHERE p.owner_id = auth.uid()
    )
  );

CREATE POLICY "cqi_all_service" ON public.content_quality_issues
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Auto-update updated_at.
-- Drop-first makes the migration idempotent: a partial apply (table created,
-- later step failed) followed by a retry would otherwise hit
-- "trigger already exists" on the CREATE.
DROP TRIGGER IF EXISTS set_cqi_updated_at ON public.content_quality_issues;
CREATE TRIGGER set_cqi_updated_at
  BEFORE UPDATE ON public.content_quality_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Flush PostgREST's schema/config caches so the new table + the new
-- project_settings columns are visible to API callers within seconds, not
-- minutes (avoids transient "column/relation does not exist" right after deploy).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
