-- Rollback for 20261003130000_auto_release.
-- Turns auto-release off for every project by dropping the opt-in; releases
-- already published automatically stay published (only the marker goes).

DROP INDEX IF EXISTS public.uq_releases_one_auto_draft;

ALTER TABLE public.releases
  DROP CONSTRAINT IF EXISTS releases_auto_source_check;

ALTER TABLE public.releases
  DROP COLUMN IF EXISTS auto_source;

ALTER TABLE public.project_settings
  DROP COLUMN IF EXISTS auto_release_enabled;
