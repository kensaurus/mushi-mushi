-- =============================================================================
-- Wave E §3e: Register `@mushi-mushi/plugin-sentry` in plugin_registry.
--
-- The plugin is the outbound complement to the inbound Sentry Seer
-- integration (`sentry-seer-poll` + `/v1/webhooks/sentry/seer`):
--   - On `report.classified` ≥ threshold: capture a Sentry event so user-
--     reported criticals show up next to telemetry-only errors.
--   - On `fix.applied`: emit an `info` event tagged `mushi.fixed=true` and
--     optionally resolve the matching Sentry issue (when configured with
--     an org auth token + slugs).
--
-- Fingerprint: ['mushi', projectId, reportId] — deterministic dedup.
-- =============================================================================

INSERT INTO plugin_registry (
  slug,
  name,
  short_description,
  publisher,
  source_url,
  manifest,
  required_scopes,
  category,
  is_official,
  is_listed
)
VALUES (
  'sentry',
  'Sentry Mirror',
  'Mirror critical user-reported bugs into Sentry; resolve the matching Sentry issue when Mushi applies a fix.',
  'mushi-mushi',
  'https://github.com/kensaurus/mushi-mushi/tree/main/packages/plugin-sentry',
  jsonb_build_object(
    'subscribes', ARRAY['report.classified', 'fix.proposed', 'fix.applied'],
    'config', jsonb_build_object(
      'sentry_dsn', 'string',
      'severity_threshold', 'string',
      'sentry_auth_token', 'string',
      'sentry_org_slug', 'string',
      'sentry_project_slug', 'string',
      'mark_in_progress', 'boolean'
    )
  ),
  ARRAY['reports.read']::text[],
  'observability',
  TRUE,
  TRUE
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  short_description = EXCLUDED.short_description,
  publisher = EXCLUDED.publisher,
  source_url = EXCLUDED.source_url,
  manifest = EXCLUDED.manifest,
  required_scopes = EXCLUDED.required_scopes,
  category = EXCLUDED.category,
  is_official = EXCLUDED.is_official,
  is_listed = EXCLUDED.is_listed,
  updated_at = now();
