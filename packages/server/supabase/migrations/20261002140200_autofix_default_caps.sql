-- ============================================================================
-- 20261002140200_autofix_default_caps
--
-- VALUE SWITCH — apply AFTER deploying fix-worker and api. It changes what
-- new projects get, not the schema; with the new fix-worker, a manual
-- dispatch runs past these caps, so they bound only what Mushi starts on its
-- own.
--
-- Plan 020 P-6: auto-fix caps were NULL on every project, so nothing bounded
-- what automatic fixes could spend. New projects now start with the caps the
-- owner approved on 2026-10-02: $2 of fix spend per 30 days and 3 dispatches
-- a day. The project_settings row is created by trg_seed_project_settings with
-- only project_id, so these defaults apply to every new project.
--
-- Existing projects are NOT changed. Those with auto-fix on and no cap get a
-- `spend_cap_unset` radar finding, fixed with
-- PUT /v1/admin/projects/:id/autofix/caps.
--
-- Verification (run after applying):
--   select column_name, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'project_settings'
--      and column_name in ('autofix_max_spend_usd', 'autofix_max_dispatches_per_day');
--   -- expect 2 and 3.
--   -- Existing rows are untouched:
--   select count(*) filter (where autofix_max_spend_usd is null) from public.project_settings;
-- ============================================================================

ALTER TABLE public.project_settings
  ALTER COLUMN autofix_max_spend_usd SET DEFAULT 2,
  ALTER COLUMN autofix_max_dispatches_per_day SET DEFAULT 3;

COMMENT ON COLUMN public.project_settings.autofix_max_spend_usd IS
  '30-day cap on fix-worker LLM spend for dispatches Mushi starts on its own. NULL = no cap. Default 2 for projects created after 2026-10-02.';
COMMENT ON COLUMN public.project_settings.autofix_max_dispatches_per_day IS
  'Daily cap on dispatches Mushi starts on its own (manual dispatches are never blocked). NULL = no cap. Default 3 for projects created after 2026-10-02.';
