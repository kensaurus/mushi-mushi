-- ============================================================
-- D7: Multi-repo coordinated fix agents.
--
-- A single bug is often a "the FE sends bad shape → BE 400s" story.
-- Mushi already has one repo per project. This migration adds:
--
--   * `project_repos`           — N repos per project, each with a role
--                                  (frontend/backend/mobile/ai/infra)
--                                  and `path_globs` used to route fixes.
--   * `fix_coordinations`       — the parent group: one row per coordinated
--                                  multi-repo fix attempt.
--   * fix_attempts.coordination_id  — backref to the coordination group.
--   * fix_attempts.repo_id      — which project_repo this attempt targets.
--   * fix_attempts.repo_role    — denormalized role for fast filtering.
--
-- The orchestrator can then plan: "this fix needs FE + BE", spawn one
-- attempt per repo, link them via coordination_id, and cross-link the
-- resulting PRs.
-- ============================================================

CREATE TABLE IF NOT EXISTS project_repos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_url        TEXT NOT NULL,
  role            TEXT NOT NULL
    CHECK (role IN ('frontend','backend','mobile','ai','infra','docs','monorepo','other')),
  default_branch  TEXT NOT NULL DEFAULT 'main',
  path_globs      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  github_app_installation_id BIGINT,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, repo_url)
);

CREATE INDEX IF NOT EXISTS idx_project_repos_project ON project_repos (project_id);
CREATE INDEX IF NOT EXISTS idx_project_repos_role ON project_repos (project_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_repos_one_primary
  ON project_repos (project_id) WHERE is_primary = TRUE;

COMMENT ON COLUMN project_repos.path_globs IS
  'glob patterns (e.g. {apps/web/**,packages/ui/**}) used by the multi-repo orchestrator to route file changes to the right repo. Empty array = no path constraint.';
COMMENT ON COLUMN project_repos.is_primary IS
  'exactly one primary repo per project — backref for legacy single-repo flows that haven''t been re-pointed at project_repos yet.';

-- ----------------------------------------------------------------
-- Coordination group: links N fix_attempts as one customer-facing unit.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fix_coordinations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','running','partial_success','succeeded','failed','cancelled')),
  plan            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fix_coord_project ON fix_coordinations (project_id, status);
CREATE INDEX IF NOT EXISTS idx_fix_coord_report ON fix_coordinations (report_id);

COMMENT ON TABLE fix_coordinations IS
  'parent of N fix_attempts that together resolve one report across multiple repos. The status rolls up child statuses: succeeded only if every child PR merged.';
COMMENT ON COLUMN fix_coordinations.plan IS
  'the planning agent''s decomposition. Shape: {tasks:[{repo_id,role,description,path_hints}]}.';

-- ----------------------------------------------------------------
-- fix_attempts: link to coordination + repo
-- ----------------------------------------------------------------
ALTER TABLE fix_attempts
  ADD COLUMN IF NOT EXISTS coordination_id UUID REFERENCES fix_coordinations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repo_id         UUID REFERENCES project_repos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repo_role       TEXT
    CHECK (repo_role IS NULL OR repo_role IN ('frontend','backend','mobile','ai','infra','docs','monorepo','other'));

CREATE INDEX IF NOT EXISTS idx_fix_attempts_coordination ON fix_attempts (coordination_id);
CREATE INDEX IF NOT EXISTS idx_fix_attempts_repo ON fix_attempts (repo_id);

-- ----------------------------------------------------------------
-- View: roll up children → parent status the orchestrator computes
-- on every child completion.
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW fix_coordination_summary AS
SELECT
  fc.id,
  fc.project_id,
  fc.report_id,
  fc.status AS parent_status,
  COUNT(fa.id)                                        AS attempt_count,
  COUNT(*) FILTER (WHERE fa.status = 'completed')     AS completed_count,
  COUNT(*) FILTER (WHERE fa.status IN ('failed','error')) AS failed_count,
  COUNT(*) FILTER (WHERE fa.status = 'running')       AS running_count,
  array_agg(DISTINCT fa.repo_role)                    AS roles,
  array_agg(fa.pr_url) FILTER (WHERE fa.pr_url IS NOT NULL) AS pr_urls
FROM fix_coordinations fc
LEFT JOIN fix_attempts fa ON fa.coordination_id = fc.id
GROUP BY fc.id, fc.project_id, fc.report_id, fc.status;

-- ----------------------------------------------------------------
-- Backfill: every project gets one project_repos row from existing
-- project_settings.codebase_repo_url (treated as primary).
-- ----------------------------------------------------------------
INSERT INTO project_repos (project_id, repo_url, role, is_primary)
SELECT
  ps.project_id,
  COALESCE(ps.github_repo_url, ps.codebase_repo_url),
  'monorepo',
  TRUE
FROM project_settings ps
WHERE COALESCE(ps.github_repo_url, ps.codebase_repo_url) IS NOT NULL
ON CONFLICT (project_id, repo_url) DO NOTHING;

-- ----------------------------------------------------------------
-- RLS — read for project members; writes via service role only
-- (orchestrator + admin endpoints).
-- ----------------------------------------------------------------
ALTER TABLE project_repos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_coordinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_repos_select_member ON project_repos
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY fix_coord_select_member ON fix_coordinations
  FOR SELECT USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );
