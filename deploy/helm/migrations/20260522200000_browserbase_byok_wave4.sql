-- Wave 4: First-class Browserbase BYOK
-- Adds per-project Browserbase key reference to project_settings so
-- qa-story-runner can use a project-scoped key instead of the global
-- mushi_runtime_config value (which is not per-project).

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS byok_browserbase_key_ref TEXT;

COMMENT ON COLUMN public.project_settings.byok_browserbase_key_ref IS
  'Vault secret reference (vault://<uuid>) for the project BYOK Browserbase API key.
   When set, qa-story-runner uses this key instead of the platform-wide mushi_runtime_config value.';

-- Index to quickly find projects with Browserbase configured
-- (used by the qa-story-runner dispatch path).
CREATE INDEX IF NOT EXISTS project_settings_browserbase_idx
  ON public.project_settings (project_id)
  WHERE byok_browserbase_key_ref IS NOT NULL;
