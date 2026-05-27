-- ============================================================================
-- Backfill missing project_settings rows for legacy projects
-- ============================================================================
-- Root cause (discovered 2026-05-27):
--   project_settings rows are auto-inserted at project create time since the
--   Teams-v1 fix landed in billing-projects-queue-graph.ts:1318 (approximate
--   deploy date 2026-04-28). Projects created before that date have no
--   project_settings row.
--
-- Impact:
--   1. /v1/admin/projects/:id/autofix/toggle used .update() which silently
--      affects 0 rows when the settings row is missing — the toggle snaps ON
--      in the UI then immediately back OFF when the GET re-reads, making the
--      user think the API is broken.
--   2. /v1/admin/fixes/dispatch (via _shared/dispatch.ts) uses .single() which
--      throws PGRST116 on missing rows → 500 for legacy project owners.
--   3. /v1/admin/projects/:id/preflight maybeSingle()s project_settings and
--      reads autofix_enabled as false — safe default, but the user can't flip
--      it without this backfill.
--
-- Fix: INSERT ... ON CONFLICT DO NOTHING to backfill all legacy projects.
--      Then switch /autofix/toggle from .update() to .upsert() (code change).

INSERT INTO project_settings (project_id)
SELECT id
FROM   projects p
WHERE  NOT EXISTS (
  SELECT 1 FROM project_settings ps WHERE ps.project_id = p.id
)
ON CONFLICT (project_id) DO NOTHING;

-- Add codebase_index_enabled and autofix_enabled columns with safe defaults
-- if they don't exist (idempotent — skipped when already present from an
-- earlier migration in the same deploy run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_settings'
      AND column_name = 'codebase_index_enabled'
  ) THEN
    ALTER TABLE project_settings ADD COLUMN codebase_index_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_settings'
      AND column_name = 'autofix_enabled'
  ) THEN
    ALTER TABLE project_settings ADD COLUMN autofix_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;
END
$$;
