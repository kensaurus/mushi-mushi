-- Rich knowledge graph storage (Understand-Anything-compatible JSON) + analyze jobs.

CREATE TABLE IF NOT EXISTS public.project_codebase_graph (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  index_fingerprint  text NOT NULL,
  commit_sha         text,
  graph              jsonb NOT NULL,
  graph_version      int NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_codebase_graph_project UNIQUE (project_id)
);

CREATE TABLE IF NOT EXISTS public.project_codebase_fingerprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  fingerprint  jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_codebase_fingerprint UNIQUE (project_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_codebase_fingerprints_project
  ON public.project_codebase_fingerprints (project_id);

CREATE TABLE IF NOT EXISTS public.codebase_analyze_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  trigger        text NOT NULL DEFAULT 'manual',
  changed_paths  text[],
  plan           jsonb,
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_codebase_analyze_jobs_project_status
  ON public.codebase_analyze_jobs (project_id, status, created_at DESC);

ALTER TABLE public.project_codebase_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_codebase_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codebase_analyze_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS codebase_graph_member_select ON public.project_codebase_graph;
CREATE POLICY codebase_graph_member_select ON public.project_codebase_graph
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS codebase_fingerprints_member_select ON public.project_codebase_fingerprints;
CREATE POLICY codebase_fingerprints_member_select ON public.project_codebase_fingerprints
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

COMMENT ON TABLE public.project_codebase_graph IS
  'UA-compatible knowledge graph JSON per project; built by codebase-analyze-worker.';
COMMENT ON TABLE public.codebase_analyze_jobs IS
  'Queue for incremental graph analysis jobs (service-role writes only).';

NOTIFY pgrst, 'reload schema';
