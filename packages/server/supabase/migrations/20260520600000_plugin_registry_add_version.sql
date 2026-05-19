-- Add version column to plugin_registry so the marketplace catalog can surface
-- per-plugin semantic versions and the install POST no longer hardcodes '1.0.0'.
ALTER TABLE public.plugin_registry
  ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT '1.0.0';

-- Seed canonical versions for the four official reference plugins.
UPDATE public.plugin_registry SET version = '1.0.0' WHERE slug IN ('linear', 'pagerduty', 'sentry', 'zapier');

COMMENT ON COLUMN public.plugin_registry.version IS
  'Semantic version of the plugin package (e.g. ''1.0.0''). Used by the admin install flow to record which catalog version was installed.';
