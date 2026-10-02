-- ============================================================================
-- 20261002150000_repo_digest_and_diagrams
--
-- ADDITIVE. Apply BEFORE deploying the api function that reads these tables
-- (routes/repo-digest.ts). New tables only; nothing existing changes.
--
-- Plan 020 §10.3 (docs/execplans/portfolio-operator.md): repo digest and
-- architecture diagram.
--
--   repo_digest_cache       one digest per (project, commit SHA, options hash).
--                           A commit never changes, so a row never goes stale;
--                           the api keeps the newest 20 per project. Holds repo
--                           file contents: service role only (no policies).
--   project_codebase_diagrams  the LLM architecture graph per (project, SHA),
--                           every node path already validated against the git
--                           tree. Regenerated on demand only (cost). Members read.
--   public_repo_diagrams    the opt-in public page for one project: a frozen
--                           copy of the public payload (nodes, paths, edges,
--                           SHA; never file contents), who consented, and
--                           whether the static page file was written.
--                           Regenerating a diagram does not change a published
--                           page until the owner publishes again. Members read;
--                           the public page reads through the api (service role).
--
-- Verification (run after apply):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('repo_digest_cache','project_codebase_diagrams','public_repo_diagrams');
--   -- expect 3 rows
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename IN ('repo_digest_cache','project_codebase_diagrams','public_repo_diagrams');
--   -- expect rowsecurity = true for all 3
--   SELECT tablename, policyname, roles, cmd FROM pg_policies
--    WHERE tablename IN ('repo_digest_cache','project_codebase_diagrams','public_repo_diagrams');
--   -- expect exactly: project_codebase_diagrams_member_select (authenticated, SELECT),
--   --                 public_repo_diagrams_member_select (authenticated, SELECT)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'public_repo_diagrams' AND column_name = 'static_page_at';
--   -- expect 1 row
--   SELECT t, r, p, has_table_privilege(r, t, p) AS granted
--     FROM unnest(ARRAY['public.repo_digest_cache','public.project_codebase_diagrams','public.public_repo_diagrams']) AS t,
--          unnest(ARRAY['anon','authenticated']) AS r,
--          unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p
--    ORDER BY 1, 2, 3;
--   -- expect granted = true ONLY for authenticated + SELECT on project_codebase_diagrams
--   -- and public_repo_diagrams; false for every other row (repo_digest_cache: all false)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.repo_digest_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  commit_sha    text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  options_hash  text NOT NULL CHECK (options_hash ~ '^[0-9a-f]{64}$'),
  digest        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_repo_digest_cache UNIQUE (project_id, commit_sha, options_hash)
);

CREATE INDEX IF NOT EXISTS idx_repo_digest_cache_project_created
  ON public.repo_digest_cache (project_id, created_at DESC);

ALTER TABLE public.repo_digest_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.repo_digest_cache FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.repo_digest_cache IS
  'Repo digests (tree + file contents) per project, commit SHA and options hash. Service role only.';

CREATE TABLE IF NOT EXISTS public.project_codebase_diagrams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  commit_sha    text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  repo_owner    text NOT NULL,
  repo_name     text NOT NULL,
  graph         jsonb NOT NULL,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
  model         text,
  generated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_codebase_diagram_project_sha UNIQUE (project_id, commit_sha)
);

CREATE INDEX IF NOT EXISTS idx_codebase_diagrams_project_updated
  ON public.project_codebase_diagrams (project_id, updated_at DESC);

ALTER TABLE public.project_codebase_diagrams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_codebase_diagrams_member_select ON public.project_codebase_diagrams;
CREATE POLICY project_codebase_diagrams_member_select ON public.project_codebase_diagrams
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

-- Writes are service role only; members only ever read.
REVOKE ALL ON public.project_codebase_diagrams FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_codebase_diagrams TO authenticated;

COMMENT ON TABLE public.project_codebase_diagrams IS
  'AI architecture diagram per project and commit SHA; node paths validated against the git tree. Service-role writes.';

CREATE TABLE IF NOT EXISTS public.public_repo_diagrams (
  project_id    uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  diagram_id    uuid REFERENCES public.project_codebase_diagrams(id) ON DELETE SET NULL,
  commit_sha    text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  repo_owner    text NOT NULL,
  repo_name     text NOT NULL,
  repo_private  boolean NOT NULL,
  payload       jsonb NOT NULL,
  payload_hash  text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  published_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  -- When the crawlable static page (S3 mushi-mushi/r/<owner>/<repo>.html)
  -- was last written. NULL = not written (page store off or the write
  -- failed): links then go to the interactive docs view instead.
  static_page_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_repo_diagrams_repo
  ON public.public_repo_diagrams (lower(repo_owner), lower(repo_name));

ALTER TABLE public.public_repo_diagrams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_repo_diagrams_member_select ON public.public_repo_diagrams;
CREATE POLICY public_repo_diagrams_member_select ON public.public_repo_diagrams
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

-- Writes are service role only (the api's publish route); members only read.
-- anon gets nothing: the public page reads through the api.
REVOKE ALL ON public.public_repo_diagrams FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_repo_diagrams TO authenticated;

COMMENT ON TABLE public.public_repo_diagrams IS
  'Opt-in public diagram page per project: frozen public payload (no file contents), the SHA and who published it.';

NOTIFY pgrst, 'reload schema';
