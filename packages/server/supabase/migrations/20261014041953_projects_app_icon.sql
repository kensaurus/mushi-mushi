-- =============================================================================
-- Migration: projects.icon_url / icon_source / icon_checked_at
-- =============================================================================
-- APPLY ORDER: ADDITIVE. Apply BEFORE deploying `api`. Until it is applied,
-- the portfolio and project-list reads do not select these columns, so
-- applying first is safe; deploying first would fail those reads.
--
-- Portfolio cards and the project switcher showed letter monograms for every
-- app (owner, 2026-10-14: "show the apps' own icons"). The App Store and
-- Google Play listings already carry each app's icon (iTunes lookup
-- artworkUrl512, Play listing image), and the App Store Connect / Play
-- Console connector snapshots know each app's ids. _shared/app-icon.ts
-- resolves the store icon and stores it here, so a page load never fetches a
-- store: store icon first, then the site favicon (console), then initials.
--
--   icon_url         https URL of the app's store icon; NULL = none found
--   icon_source      'app_store' | 'google_play' (NULL with icon_url NULL)
--   icon_checked_at  when the stores were last asked; refreshed after 7 days
--
-- No new table, so no new RLS: projects keeps its existing policies. The
-- service role writes these columns from the api function.
--
-- Verification (after apply):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'projects'
--     AND column_name IN ('icon_url', 'icon_source', 'icon_checked_at');
--   -- expect 3 rows, all nullable
-- =============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS icon_url text,
  ADD COLUMN IF NOT EXISTS icon_source text,
  ADD COLUMN IF NOT EXISTS icon_checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_icon_source_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_icon_source_check
      CHECK (
        (icon_url IS NULL AND icon_source IS NULL)
        OR (icon_url ~ '^https://' AND icon_source IN ('app_store', 'google_play'))
      );
  END IF;
END $$;

COMMENT ON COLUMN public.projects.icon_url IS
  'The app''s store icon (App Store artworkUrl512 or Google Play listing image), resolved by _shared/app-icon.ts. NULL = none found.';
COMMENT ON COLUMN public.projects.icon_source IS
  'Where icon_url came from: app_store | google_play.';
COMMENT ON COLUMN public.projects.icon_checked_at IS
  'When the stores were last asked for this app''s icon; refreshed after 7 days.';
