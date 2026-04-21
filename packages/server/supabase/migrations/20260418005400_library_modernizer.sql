-- Migration: 20260418005400_library_modernizer
-- Purpose: weekly cron: scrapes upstream release-notes for outdated
--            top-level dependencies and files them as enhancement reports
--            so they land in the same triage queue as user-reported bugs.
--
-- TABLES:
--   * `modernization_findings` — one row per (repo, dep) pair the LLM
--     thinks is materially behind. Linked to a synthetic report so the
--     existing /reports + /fixes flow renders it without changes.

CREATE TABLE IF NOT EXISTS modernization_findings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id             uuid REFERENCES project_repos(id) ON DELETE CASCADE,
  dep_name            TEXT NOT NULL,
  current_version     TEXT,
  suggested_version   TEXT,
  manifest_path       TEXT,
  summary             TEXT NOT NULL,
  severity            TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('major','minor','security','deprecated')),
  changelog_url       TEXT,
  related_report_id   uuid REFERENCES reports(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dispatched','dismissed')),
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, repo_id, dep_name, suggested_version)
);

CREATE INDEX IF NOT EXISTS idx_modernization_findings_project_status
  ON modernization_findings (project_id, status, detected_at DESC);

ALTER TABLE modernization_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read modernization findings"
  ON modernization_findings
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "service role write modernization findings"
  ON modernization_findings
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- Cron schedule (mirror of repo-indexer wrapper).
DO $$
DECLARE
  has_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') INTO has_cron;
  IF NOT has_cron THEN
    RAISE NOTICE 'pg_cron not installed; skipping library-modernizer cron registration';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
    FROM cron.job
   WHERE jobname = 'mushi-library-modernizer-weekly';

  PERFORM cron.schedule(
    'mushi-library-modernizer-weekly',
    '0 6 * * 0',
    $cron$
      SELECT net.http_post(
        url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/library-modernizer',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body    := jsonb_build_object('mode', 'sweep')
      );
    $cron$
  );
END $$;
