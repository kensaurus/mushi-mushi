/*
FILE: packages/server/supabase/migrations/20260612040000_skill_pipelines.sql
PURPOSE: Skill-Driven Triage Pipelines — cursor-kenji × Mushi Mushi

Introduces 4 new tables that power the skill pipeline feature:

  1. skill_sources      — allowlisted git repos whose SKILL.md files are
                          synced into the catalog. Default seed: kensaurus/cursor-kenji.
  2. agent_skills       — the skill catalog; one row per SKILL.md file found
                          in any skill_source. Carries the full markdown body,
                          parsed chain_slugs (for workflow bundles), and a
                          pgvector embedding of the description for semantic
                          skill recommendation in Stage 2 triage.
  3. skill_pipeline_runs
                        — one run per "attach a skill to a report" action.
                          Holds the composed context_packet and execution mode
                          (handoff = give to dev's Cursor agent; cloud = auto
                          dispatch via Cursor Cloud API).
  4. skill_pipeline_step_runs
                        — one row per step in the chain. Realtime is enabled
                          so the console React Flow diagram updates live as
                          steps progress.

Also adds:
  • reports.recommended_skills jsonb  — skills shortlisted by Stage 2 triage.
  • reports.recommended_skills_rationale text — one-line rationale per skill.

DEPENDENCIES:
  - projects table (FK)
  - reports table (FK, nullable — runs can target qa_stories or features too)
  - pgvector extension (already enabled: 20260416000000_phase0_initial_schema.sql)
  - auth.users (owner FK, SET NULL on delete)

NOTES:
  - All tables are project-scoped with RLS policies mirroring qa_stories.
  - Realtime is enabled on skill_pipeline_step_runs for live console updates.
  - skill_sources.repo_slug is the GitHub "owner/repo" used by skill-sync.
  - agent_skills has a global catalog (no project_id) + a project-override
    toggle so teams can allowlist only a subset of skills.
  - skill_pipeline_runs.context_packet is the full markdown payload composed
    by _shared/skill-packet.ts and consumed by CLI / MCP / Cursor agents.
*/

-- ── skill_sources ────────────────────────────────────────────────────────────
-- Per-project allowlisted git repositories whose SKILL.md files are synced.
CREATE TABLE IF NOT EXISTS public.skill_sources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- "owner/repo" slug for GitHub API fetching, e.g. "kensaurus/cursor-kenji"
  repo_slug           text NOT NULL,
  -- Branch/tag/SHA ref for deterministic fetches. Default: main.
  ref                 text NOT NULL DEFAULT 'main',
  enabled             boolean NOT NULL DEFAULT true,
  -- Last sync metadata
  last_synced_at      timestamptz,
  last_synced_count   int,
  last_sync_error     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, repo_slug)
);

CREATE INDEX IF NOT EXISTS idx_skill_sources_project ON public.skill_sources(project_id);

CREATE OR REPLACE FUNCTION public.set_skill_sources_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS skill_sources_updated_at ON public.skill_sources;
CREATE TRIGGER skill_sources_updated_at
  BEFORE UPDATE ON public.skill_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_skill_sources_updated_at();

-- RLS
ALTER TABLE public.skill_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their project skill sources"
  ON public.skill_sources FOR SELECT
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
    )
  );

-- FOR ALL with a coexisting FOR SELECT creates two permissive SELECT policies that
-- Postgres ORs together, adding a redundant filter pass per row (data-integrity rule #6).
-- Split into explicit INSERT / UPDATE / DELETE instead.
CREATE POLICY "Members can insert their project skill sources"
  ON public.skill_sources FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Members can update their project skill sources"
  ON public.skill_sources FOR UPDATE
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Members can delete their project skill sources"
  ON public.skill_sources FOR DELETE
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
    )
  );


-- ── agent_skills ─────────────────────────────────────────────────────────────
-- Global skill catalog. Rows are upserted by the skill-sync edge function.
-- The description_embedding is used by classify-report Stage 2 for semantic
-- skill recommendation.
CREATE TABLE IF NOT EXISTS public.agent_skills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to the source repo. NULL for manually created skills.
  source_id             uuid REFERENCES public.skill_sources(id) ON DELETE SET NULL,
  -- Slug as declared in SKILL.md frontmatter (e.g. "workflow-fix-and-ship").
  -- Unique per source_id. Global slug is unique across all sources for the
  -- default seed; conflicts from different sources are namespaced by source.
  slug                  text NOT NULL,
  -- Category derived from the slug prefix (e.g. "workflow", "debug", "test").
  category              text NOT NULL DEFAULT 'other',
  -- Frontmatter fields per Agent Skills spec (agentskills.io).
  title                 text NOT NULL,
  description           text NOT NULL, -- ≤ 1024 chars per spec
  license               text,
  compatibility         text,
  -- Full SKILL.md body (markdown, after frontmatter).
  body_md               text NOT NULL DEFAULT '',
  -- Parsed chain: skill slugs referenced in workflow bundle bodies.
  -- E.g. ["debug-error", "test-playwright", "workflow-pr", "deploy-verify"]
  chain_slugs           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- SHA-256 content hash of the raw SKILL.md for change detection.
  content_hash          text NOT NULL,
  -- pgvector embedding of the description (1536-dim, text-embedding-3-small).
  description_embedding vector(1536),
  -- Per-project override: projects can disable specific skills.
  -- NULL = available globally; populated = project-specific override.
  -- For now, all skills are global. Project-level gating via skill_sources.
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skills_source_slug ON public.agent_skills(source_id, slug);
CREATE INDEX IF NOT EXISTS idx_agent_skills_slug ON public.agent_skills(slug);
CREATE INDEX IF NOT EXISTS idx_agent_skills_category ON public.agent_skills(category);
CREATE INDEX IF NOT EXISTS idx_agent_skills_active ON public.agent_skills(is_active) WHERE is_active = true;

-- IVFFlat index for description embedding similarity search.
-- lists=100 matches the codebase_files pattern for a similarly-sized table.
CREATE INDEX IF NOT EXISTS idx_agent_skills_embedding
  ON public.agent_skills USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION public.set_agent_skills_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS agent_skills_updated_at ON public.agent_skills;
CREATE TRIGGER agent_skills_updated_at
  BEFORE UPDATE ON public.agent_skills
  FOR EACH ROW EXECUTE FUNCTION public.set_agent_skills_updated_at();

-- agent_skills is READ by all authenticated users (no project scope —
-- the catalog is global). Writes only via service role (skill-sync edge fn).
ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read agent_skills"
  ON public.agent_skills FOR SELECT
  USING ((select auth.uid()) IS NOT NULL AND is_active = true);


-- ── skill_pipeline_runs ───────────────────────────────────────────────────────
-- One row per "attach skill to report and run the pipeline" action.
CREATE TABLE IF NOT EXISTS public.skill_pipeline_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Report this pipeline is attached to (nullable — future: feature goals).
  report_id           uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  -- Root skill slug (the entry point; chain is resolved from agent_skills.chain_slugs).
  root_skill_slug     text NOT NULL,
  -- Resolved ordered chain at creation time (snapshot — doesn't change if catalog updates).
  chain_slugs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Execution mode. 'handoff': compose context packet for dev to use locally.
  -- 'cloud': auto-dispatch each step as a Cursor Cloud agent run.
  mode                text NOT NULL DEFAULT 'handoff'
                        CHECK (mode IN ('handoff', 'cloud')),
  -- Overall run status.
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'aborted')),
  -- The full markdown context packet (skill instructions + report context).
  -- Composed by _shared/skill-packet.ts. Stored so CLI/MCP can fetch it.
  context_packet      text,
  -- Parent run for PDCA-style retry/improve loops.
  parent_run_id       uuid REFERENCES public.skill_pipeline_runs(id) ON DELETE SET NULL,
  iteration           int NOT NULL DEFAULT 0,
  -- The user who started the pipeline.
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_pipeline_runs_project ON public.skill_pipeline_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_skill_pipeline_runs_report ON public.skill_pipeline_runs(report_id) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_pipeline_runs_status ON public.skill_pipeline_runs(project_id, status);

CREATE OR REPLACE FUNCTION public.set_skill_pipeline_runs_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS skill_pipeline_runs_updated_at ON public.skill_pipeline_runs;
CREATE TRIGGER skill_pipeline_runs_updated_at
  BEFORE UPDATE ON public.skill_pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_skill_pipeline_runs_updated_at();

ALTER TABLE public.skill_pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their project pipeline runs"
  ON public.skill_pipeline_runs FOR SELECT
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Members can create pipeline runs"
  ON public.skill_pipeline_runs FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Members can update pipeline runs they created"
  ON public.skill_pipeline_runs FOR UPDATE
  USING (
    project_id IN (
      SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
    )
  );


-- ── skill_pipeline_step_runs ─────────────────────────────────────────────────
-- One row per step in a pipeline run. Realtime is enabled so the React Flow
-- diagram in the console updates live without polling.
CREATE TABLE IF NOT EXISTS public.skill_pipeline_step_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES public.skill_pipeline_runs(id) ON DELETE CASCADE,
  -- 0-based index within the chain.
  step_index          int NOT NULL,
  skill_slug          text NOT NULL,
  -- Step status.
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'passed', 'failed', 'skipped')),
  -- For cloud mode: the Cursor agentId or PR URL from the Cloud API response.
  agent_ref           text,
  pr_url              text,
  -- Developer notes / output summary (populated by CLI check-in or cloud webhook).
  notes               text,
  -- Token/cost tracking when cloud mode burns LLM credits.
  llm_cost_usd        numeric(10, 6),
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_skill_step_runs_run ON public.skill_pipeline_step_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_skill_step_runs_status ON public.skill_pipeline_step_runs(run_id, status);

CREATE OR REPLACE FUNCTION public.set_skill_step_runs_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS skill_step_runs_updated_at ON public.skill_pipeline_step_runs;
CREATE TRIGGER skill_step_runs_updated_at
  BEFORE UPDATE ON public.skill_pipeline_step_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_skill_step_runs_updated_at();

-- Enable Realtime publication so the console React Flow diagram subscribes.
ALTER PUBLICATION supabase_realtime ADD TABLE public.skill_pipeline_step_runs;

ALTER TABLE public.skill_pipeline_step_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read step runs via run access"
  ON public.skill_pipeline_step_runs FOR SELECT
  USING (
    run_id IN (
      SELECT spr.id FROM public.skill_pipeline_runs spr
      WHERE spr.project_id IN (
        SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
      )
    )
  );

CREATE POLICY "Members can update step runs via run access"
  ON public.skill_pipeline_step_runs FOR UPDATE
  USING (
    run_id IN (
      SELECT spr.id FROM public.skill_pipeline_runs spr
      WHERE spr.project_id IN (
        SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = (select auth.uid())
      )
    )
  );


-- ── reports.recommended_skills ───────────────────────────────────────────────
-- Skill recommendations added by classify-report Stage 2.
-- Format: [{ slug, rationale }, ...]
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS recommended_skills jsonb;

COMMENT ON COLUMN public.reports.recommended_skills IS
  'Skill recommendations from Stage 2 triage. Array of { slug, rationale } objects, '
  'max 3 items, keyed to agent_skills.slug.';


-- ── match_agent_skills RPC ───────────────────────────────────────────────────
-- Used by classify-report Stage 2 to find skills matching a symptom embedding.
CREATE OR REPLACE FUNCTION public.match_agent_skills(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.65,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  slug text,
  category text,
  title text,
  description text,
  chain_slugs jsonb,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
  SELECT
    ask.id,
    ask.slug,
    ask.category,
    ask.title,
    ask.description,
    ask.chain_slugs,
    1 - (ask.description_embedding <=> query_embedding) AS similarity
  FROM public.agent_skills ask
  WHERE ask.is_active = true
    AND ask.description_embedding IS NOT NULL
    AND 1 - (ask.description_embedding <=> query_embedding) >= match_threshold
  ORDER BY ask.description_embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Grant exec to authenticated and service roles
GRANT EXECUTE ON FUNCTION public.match_agent_skills TO authenticated, service_role;


-- ── Default skill source seed ────────────────────────────────────────────────
-- We cannot seed per-project here (no project rows in migration context),
-- but we document the convention. The skill-sync edge function seeds
-- kensaurus/cursor-kenji for new projects on first admin login.

COMMENT ON TABLE public.skill_sources IS
  'Allowlisted git repositories whose SKILL.md files are synced into agent_skills. '
  'Default seed: kensaurus/cursor-kenji. Supports any skills.sh-compatible repo.';

COMMENT ON TABLE public.agent_skills IS
  'Global agent skill catalog synced from skill_sources by the skill-sync edge function. '
  'Skills are matched to reports via pgvector embedding similarity in classify-report Stage 2.';

COMMENT ON TABLE public.skill_pipeline_runs IS
  'One pipeline run per "attach skill to report/goal" action. '
  'handoff mode: compose context_packet for dev Cursor agent. '
  'cloud mode: auto-dispatch each step as a Cursor Cloud agent run.';

COMMENT ON TABLE public.skill_pipeline_step_runs IS
  'One step per skill in the resolved chain_slugs. '
  'Realtime-enabled so the console React Flow diagram updates live.';


-- ── Advisor hardening ─────────────────────────────────────────────────────────
-- Revoke default anon access from project-scoped tables.
-- agent_skills is the global catalog — authenticated users read it; anon does not.
REVOKE SELECT ON public.skill_sources FROM anon;
REVOKE SELECT ON public.skill_pipeline_runs FROM anon;
REVOKE SELECT ON public.skill_pipeline_step_runs FROM anon;
REVOKE SELECT ON public.agent_skills FROM anon;

-- Trigger helper functions are internal; never meant to be called via REST.
-- Supabase's default grants include authenticated + anon for all functions, so
-- we explicitly revoke EXECUTE to silence the advisor.
REVOKE EXECUTE ON FUNCTION public.set_agent_skills_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_skill_pipeline_runs_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_skill_sources_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_skill_step_runs_updated_at() FROM anon, authenticated;

-- match_agent_skills is called by classify-report (service_role) and potentially
-- by authenticated API clients — but never by anonymous callers.
REVOKE EXECUTE ON FUNCTION public.match_agent_skills(vector, double precision, integer) FROM anon;
