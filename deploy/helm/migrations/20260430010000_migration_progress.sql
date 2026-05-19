-- =============================================================================
-- migration_progress — DB-backed sync for the docs Migration Hub checklist.
--
-- Background:
--   The docs site (apps/docs/components/MigrationChecklist.tsx) ships an
--   anonymous-first checklist persisted to localStorage under the key
--   `mushi:migration:<slug>`. Phase 2 of the Migration Hub adds opt-in cloud
--   sync so a logged-in user (or a project member) can pick up where they
--   left off across devices and surface in-progress migrations on the admin
--   console (`MigrationsInProgressCard` on OnboardingPage / ProjectsPage).
--
-- Why a single table with a nullable project_id:
--   We support BOTH scopes from one row shape:
--     * account-scoped progress (project_id IS NULL) — for users browsing
--       the docs without an active project, or upgrading the Mushi SDK
--       across all their projects.
--     * project-scoped progress (project_id IS NOT NULL) — for team work
--       like "we're migrating Acme Web from Capacitor to React Native";
--       all project members can see the row.
--   PostgreSQL's UNIQUE treats NULLs as distinct, so a naive
--   UNIQUE (user_id, project_id, guide_slug) would happily insert two
--   account-scoped rows for the same (user, slug). We use two PARTIAL
--   UNIQUE indexes instead — one per scope — to enforce single-row-per-
--   (user, slug, scope) without that gotcha.
--
-- RLS posture:
--   * Account-scoped rows: only the owning user (auth.uid() = user_id) can
--     read/write/delete. Service role bypasses for Edge Functions.
--   * Project-scoped rows: any member of the project's org or the project
--     itself (mirrors `private.is_project_member` from the Teams v1
--     migration) can read; only the owning user can write/delete their own
--     row. The cap on project_id existence is enforced by the FK.
--   * `(SELECT auth.uid())` is wrapped in a subselect to match the repo's
--     RLS performance convention (Wave T initplan fix).
--
-- Indexes:
--   * Two partial UNIQUE constraints (one per scope) — see above.
--   * idx_migration_progress_project_recent for the admin card's
--     "in-progress migrations" lookup.
--   * idx_migration_progress_user_recent for the docs sync hook's
--     "all my account-scoped progress" lookup.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.migration_progress (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  project_id               uuid        NULL     REFERENCES public.projects(id)   ON DELETE CASCADE,
  guide_slug               text        NOT NULL
                            CHECK (
                              char_length(guide_slug) BETWEEN 1 AND 80
                              AND guide_slug ~ '^[a-z0-9][a-z0-9-]*$'
                            ),
  completed_step_ids       text[]      NOT NULL DEFAULT '{}',
  required_step_count      integer     NULL CHECK (required_step_count IS NULL OR required_step_count >= 0),
  completed_required_count integer     NOT NULL DEFAULT 0
                            CHECK (completed_required_count >= 0),
  source                   text        NOT NULL DEFAULT 'docs'
                            CHECK (source IN ('docs', 'admin', 'cli')),
  -- The client clock at the moment progress was captured; we keep the
  -- server clock in created_at/updated_at so we can detect skew. Nullable
  -- because legacy / stub rows seeded by the admin card don't have one.
  client_updated_at        timestamptz NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Two partial uniques because PG treats NULLs as distinct (see header).
CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_progress_account_unique
  ON public.migration_progress (user_id, guide_slug)
  WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_progress_project_unique
  ON public.migration_progress (user_id, project_id, guide_slug)
  WHERE project_id IS NOT NULL;

-- Admin card: "show me the most recent in-progress migrations on this project".
CREATE INDEX IF NOT EXISTS idx_migration_progress_project_recent
  ON public.migration_progress (project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

-- Docs sync hook: "give me all of my account-scoped progress, newest first".
CREATE INDEX IF NOT EXISTS idx_migration_progress_user_recent
  ON public.migration_progress (user_id, updated_at DESC);

-- Reuse the existing trigger function from 20260416700000_schema_hardening.sql
-- (set_updated_at) so we inherit the immutable search_path hardening.
DROP TRIGGER IF EXISTS trg_migration_progress_updated_at ON public.migration_progress;
CREATE TRIGGER trg_migration_progress_updated_at
  BEFORE UPDATE ON public.migration_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.migration_progress ENABLE ROW LEVEL SECURITY;

-- ── RLS policies ──────────────────────────────────────────────────────────
DO $policies$
BEGIN
  -- Owning user can read their own rows (both account and project scope).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'migration_progress'
       AND policyname = 'migration_progress_select_self'
  ) THEN
    CREATE POLICY migration_progress_select_self ON public.migration_progress
      FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  -- Project members can read project-scoped rows from teammates.
  -- private.is_project_member already returns true for org members + per-
  -- project members + project owners, so this single check covers all the
  -- shapes the admin card cares about.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'migration_progress'
       AND policyname = 'migration_progress_select_project_member'
  ) THEN
    CREATE POLICY migration_progress_select_project_member ON public.migration_progress
      FOR SELECT TO authenticated
      USING (
        project_id IS NOT NULL
        AND private.is_project_member(project_id)
      );
  END IF;

  -- Writes (insert/update/delete) are always self-scoped — a teammate cannot
  -- mark steps complete on someone else's behalf. If a project_id is set,
  -- the writer must also be a member of that project (so they can't park
  -- their progress under a project they don't belong to).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'migration_progress'
       AND policyname = 'migration_progress_insert_self'
  ) THEN
    CREATE POLICY migration_progress_insert_self ON public.migration_progress
      FOR INSERT TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (project_id IS NULL OR private.is_project_member(project_id))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'migration_progress'
       AND policyname = 'migration_progress_update_self'
  ) THEN
    CREATE POLICY migration_progress_update_self ON public.migration_progress
      FOR UPDATE TO authenticated
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (project_id IS NULL OR private.is_project_member(project_id))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'migration_progress'
       AND policyname = 'migration_progress_delete_self'
  ) THEN
    CREATE POLICY migration_progress_delete_self ON public.migration_progress
      FOR DELETE TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  -- Service role bypass for the Hono Edge Functions.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'migration_progress'
       AND policyname = 'migration_progress_service_role_all'
  ) THEN
    CREATE POLICY migration_progress_service_role_all ON public.migration_progress
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $policies$;

COMMENT ON TABLE public.migration_progress IS
  'Per-user (and optionally per-project) checklist progress for the docs Migration Hub. Powers cross-device sync and the admin "Migrations in progress" card.';
COMMENT ON COLUMN public.migration_progress.completed_step_ids IS
  'Sorted, deduplicated array of step IDs the user has marked complete. Server normalises on write so order is stable for diff/merge.';
COMMENT ON COLUMN public.migration_progress.source IS
  'Where the most recent write originated: docs (sync hook), admin (manual edit from console), or cli (mushi migrate progress).';
