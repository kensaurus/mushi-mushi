-- Refresh sdk_versions catalogue to current 1.7.x publish line.
-- Without this upsert the admin compares observed v1.7.x against the
-- stale v0.9.0 winner from 20260508600000 and marks every dogfood
-- project "outdated" with a confusing "→ v0.9.0" downgrade arrow.

INSERT INTO public.sdk_versions (package, version, deprecated, released_at)
VALUES
  ('@mushi-mushi/core',         '1.7.5', false, now()),
  ('@mushi-mushi/web',          '1.7.8', false, now()),
  ('@mushi-mushi/react',        '1.6.0', false, now()),
  ('@mushi-mushi/vue',          '1.6.0', false, now()),
  ('@mushi-mushi/svelte',       '1.6.0', false, now()),
  ('@mushi-mushi/angular',      '1.6.0', false, now()),
  ('@mushi-mushi/react-native', '1.6.0', false, now()),
  ('@mushi-mushi/cli',          '0.12.0', false, now()),
  ('@mushi-mushi/node',         '0.5.1', false, now())
ON CONFLICT (package, version)
DO UPDATE SET
  deprecated  = EXCLUDED.deprecated,
  released_at = EXCLUDED.released_at;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
