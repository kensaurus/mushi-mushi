-- =============================================================================
-- Migration: sentry_extra_project_slugs
-- =============================================================================
-- APPLY ORDER: ADDITIVE — apply BEFORE deploying the `api` function. The new
-- sentry import route selects this column; the route falls back to the single
-- slug if the column is missing, but apply first anyway.
--
-- One Mushi project can sit on more than one Sentry project in the same org
-- (solo-boss-cloud: sbc-front + sbc-be). The import route used to confine
-- imports to `sentry_project_slug` alone, so sbc-be's backlog could not be
-- imported at all. `sentry_project_slug` stays the primary (seer-poll and the
-- console keep using it); this column lists the others an import may read.
--
-- Verification (after apply):
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'project_settings'
--     AND column_name = 'sentry_extra_project_slugs';
--   -- expect: ARRAY, NO, '{}'::text[]
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.project_settings'::regclass
--     AND conname = 'project_settings_sentry_extra_project_slugs_check';
-- =============================================================================

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS sentry_extra_project_slugs text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_settings'::regclass
      AND conname = 'project_settings_sentry_extra_project_slugs_check'
  ) THEN
    ALTER TABLE public.project_settings
      ADD CONSTRAINT project_settings_sentry_extra_project_slugs_check
      CHECK (cardinality(sentry_extra_project_slugs) <= 10);
  END IF;
END $$;

COMMENT ON COLUMN public.project_settings.sentry_extra_project_slugs IS
  'Other Sentry project slugs (same org as sentry_org_slug) whose issues the '
  'Sentry import may pull into this Mushi project. sentry_project_slug stays '
  'the primary. At most 10.';
