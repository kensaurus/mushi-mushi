-- Upsert SDK catalogue to v0.9.0.
--
-- The initial seed (20260429000000_sdk_versions.sql) populated the table with
-- v0.7.0 as the "latest" for all packages. Since then the SDK has shipped
-- v0.9.0 across @mushi-mushi/web, /react, /core, /vue, /svelte, /angular,
-- and /react-native. Without this upsert the Projects page's SdkVersionBadge
-- compares observed=0.9.0 against catalog-latest=0.7.0 and incorrectly marks
-- every project as "outdated" (↑ web v0.9.0 → v0.7.0).
--
-- Inserting the new rows with a *later* released_at keeps the existing v0.7.0
-- rows in place (useful for upgrade-path audits) while making the v0.9.0 row
-- the winner of `ORDER BY released_at DESC LIMIT 1` in the admin API query.

INSERT INTO public.sdk_versions (package, version, deprecated, released_at)
VALUES
  ('@mushi-mushi/core',         '0.9.0', false, now()),
  ('@mushi-mushi/web',          '0.9.0', false, now()),
  ('@mushi-mushi/react',        '0.9.0', false, now()),
  ('@mushi-mushi/vue',          '0.9.0', false, now()),
  ('@mushi-mushi/svelte',       '0.9.0', false, now()),
  ('@mushi-mushi/angular',      '0.9.0', false, now()),
  ('@mushi-mushi/react-native', '0.9.0', false, now())
ON CONFLICT (package, version)
DO UPDATE SET
  deprecated    = EXCLUDED.deprecated,
  released_at   = EXCLUDED.released_at;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
