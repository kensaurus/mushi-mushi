-- Fix: deprecate incorrectly-seeded 0.9.0 rows for the 4 framework adapters
-- that are still at 0.8.1 in the monorepo, and insert the correct 0.8.1 rows.
-- Only @mushi-mushi/core, /web, and /react shipped the 0.9.0 release.

UPDATE public.sdk_versions
SET deprecated = true
WHERE package IN (
  '@mushi-mushi/vue',
  '@mushi-mushi/svelte',
  '@mushi-mushi/angular',
  '@mushi-mushi/react-native'
)
AND version = '0.9.0';

INSERT INTO public.sdk_versions (package, version, deprecated, released_at)
VALUES
  ('@mushi-mushi/vue',          '0.8.1', false, now()),
  ('@mushi-mushi/svelte',       '0.8.1', false, now()),
  ('@mushi-mushi/angular',      '0.8.1', false, now()),
  ('@mushi-mushi/react-native', '0.8.1', false, now())
ON CONFLICT (package, version)
DO UPDATE SET
  deprecated  = EXCLUDED.deprecated,
  released_at = EXCLUDED.released_at;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
