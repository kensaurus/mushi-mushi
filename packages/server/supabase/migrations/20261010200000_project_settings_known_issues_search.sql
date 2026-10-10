-- =============================================================================
-- Migration: project_settings.known_issues_search_enabled
-- =============================================================================
-- APPLY ORDER: ADDITIVE. Apply BEFORE deploying `api` and `classify-report`.
-- Until it is applied, classify-report reads the setting as OFF (an unreadable
-- setting is treated as disabled), so deploying first is safe but searches
-- nothing.
--
-- "Others who hit this" (_shared/known-issues.ts, #467) sends the report's
-- error message, with IDs, URLs and long numbers removed, to Firecrawl to
-- search GitHub and Stack Overflow for known fixes. Firecrawl is a third-party
-- processor, so the search is a per-project opt-in, default OFF. Project
-- admins turn it on in Settings → Web tools.
--
-- No new table, so no new RLS: project_settings keeps its existing policies.
--
-- Verification (after apply):
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'project_settings'
--     AND column_name = 'known_issues_search_enabled';
--   -- expect: boolean, NO, false
-- =============================================================================

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS known_issues_search_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_settings.known_issues_search_enabled IS
  'Opt-in: after classification, send the scrubbed error message to Firecrawl to search GitHub and Stack Overflow for known fixes (_shared/known-issues.ts). Default off.';
