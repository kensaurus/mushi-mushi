-- Expand sdk_versions catalog from 7 → 24 packages.
--
-- Previous migrations seeded only the 7 core framework adapters
-- (@mushi-mushi/web, react, vue, svelte, angular, react-native, core).
-- The monorepo ships 24 publicly-published packages; missing rows mean
-- the VersionBadge would silently show "0.0.0" for any package not yet
-- catalogued (because the API query returns NULL → falls back to the Vite
-- build-time constant, which is fine in practice — but the badge's
-- "outdated" comparison against NULL is always truthy, so every project
-- would show a false upgrade prompt for the tooling and plugin packages).
--
-- Released_at is set to now()-interval to keep previous rows as winners for
-- the groups that were already catalogued (0.9.0 upsert above already set
-- those to now()), while the new packages get a timestamp one second after
-- the initial catalog seed so they appear in ORDER BY released_at DESC.

INSERT INTO public.sdk_versions (package, version, deprecated, released_at)
VALUES
  -- Tooling
  ('@mushi-mushi/cli',           '0.6.1', false, now() - interval '5 hours'),
  ('@mushi-mushi/mcp',           '0.3.8', false, now() - interval '5 hours'),
  ('@mushi-mushi/node',          '0.3.5', false, now() - interval '5 hours'),
  ('@mushi-mushi/capacitor',     '0.5.1', false, now() - interval '5 hours'),
  ('@mushi-mushi/adapters',      '0.2.7', false, now() - interval '5 hours'),
  ('@mushi-mushi/wasm-classifier','0.2.2', false, now() - interval '5 hours'),
  ('create-mushi-mushi',         '0.5.3', false, now() - interval '5 hours'),
  ('mushi-mushi',                '0.6.4', false, now() - interval '5 hours'),
  -- Plugin ecosystem
  ('@mushi-mushi/plugin-sdk',    '0.3.1', false, now() - interval '5 hours'),
  ('@mushi-mushi/plugin-jira',   '0.2.1', false, now() - interval '5 hours'),
  ('@mushi-mushi/plugin-linear', '0.2.3', false, now() - interval '5 hours'),
  ('@mushi-mushi/plugin-pagerduty','0.2.3', false, now() - interval '5 hours'),
  ('@mushi-mushi/plugin-sentry', '0.2.3', false, now() - interval '5 hours'),
  ('@mushi-mushi/plugin-slack-app','0.2.1', false, now() - interval '5 hours'),
  ('@mushi-mushi/plugin-zapier', '0.2.3', false, now() - interval '5 hours')
ON CONFLICT (package, version)
DO UPDATE SET
  deprecated  = EXCLUDED.deprecated,
  released_at = EXCLUDED.released_at;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
