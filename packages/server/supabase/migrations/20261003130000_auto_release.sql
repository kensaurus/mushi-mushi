-- =============================================================================
-- Migration: auto_release
-- =============================================================================
-- APPLY ORDER: ADDITIVE — apply BEFORE deploying `api`, `release-builder` and
-- `webhooks-github-indexer`. Until it is applied the opt-in reads as OFF (the
-- code treats an unreadable setting as disabled), so deploying first is safe
-- but does nothing.
--
-- Per-project opt-in "auto-release": when the host ships (a GitHub `release`
-- published, a successful production `deployment_status`, or a
-- `release.published` event on POST /v1/ingest/recipe/events), Mushi drafts
-- a release from the fixed, not-yet-released reports and publishes it, which
-- tells each reporter their bug shipped. Default OFF.
--
--   project_settings.auto_release_enabled  the opt-in (console toggle)
--   releases.auto_source                    which trigger drafted an automatic
--                                           release; NULL for a manual one
--   uq_releases_one_auto_draft              at most one automatic draft per
--                                           project at a time, so a release
--                                           event and a deploy event for the
--                                           same ship cannot both publish
--                                           (and message reporters twice)
--
-- No new table, so no new RLS: both tables keep their existing policies.
--
-- Verification (after apply):
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND ((table_name = 'project_settings' AND column_name = 'auto_release_enabled')
--       OR (table_name = 'releases' AND column_name = 'auto_source'));
--   -- expect: boolean NO false; text YES NULL
--   SELECT indexname FROM pg_indexes WHERE indexname = 'uq_releases_one_auto_draft';
-- =============================================================================

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS auto_release_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_settings.auto_release_enabled IS
  'Opt-in: draft and publish a release (notifying reporters) when the host ships '
  '(GitHub release published, successful production deployment_status, or a '
  'release.published recipe event). Default false.';

ALTER TABLE public.releases
  ADD COLUMN IF NOT EXISTS auto_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.releases'::regclass
      AND conname = 'releases_auto_source_check'
  ) THEN
    ALTER TABLE public.releases
      ADD CONSTRAINT releases_auto_source_check
      CHECK (auto_source IS NULL OR auto_source IN ('github_release', 'github_deployment', 'recipe_event'));
  END IF;
END $$;

COMMENT ON COLUMN public.releases.auto_source IS
  'Trigger that drafted an automatic release (github_release, github_deployment, '
  'recipe_event); NULL for a release drafted by a person.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_releases_one_auto_draft
  ON public.releases (project_id)
  WHERE status = 'draft' AND auto_source IS NOT NULL;
