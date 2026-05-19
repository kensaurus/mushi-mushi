-- SDK package identity + freshness metadata.
-- Keeps host-app `reports.app_version` separate from the npm package version
-- that submitted the report, so support can tell "their app is v42" from
-- "their Mushi SDK is outdated".

CREATE TABLE IF NOT EXISTS public.sdk_versions (
  package text NOT NULL,
  version text NOT NULL,
  deprecated boolean NOT NULL DEFAULT false,
  deprecation_message text,
  released_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (package, version),
  CHECK (package <> ''),
  CHECK (version <> '')
);

CREATE INDEX IF NOT EXISTS sdk_versions_latest_idx
  ON public.sdk_versions (package, released_at DESC);

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS sdk_package text,
  ADD COLUMN IF NOT EXISTS sdk_version text;

CREATE INDEX IF NOT EXISTS reports_sdk_version_idx
  ON public.reports (sdk_package, sdk_version)
  WHERE sdk_package IS NOT NULL AND sdk_version IS NOT NULL;

INSERT INTO public.sdk_versions(package, version, deprecated, released_at)
VALUES
  ('@mushi-mushi/core', '0.7.0', false, now()),
  ('@mushi-mushi/web', '0.7.0', false, now()),
  ('@mushi-mushi/react', '0.7.0', false, now()),
  ('@mushi-mushi/vue', '0.7.0', false, now()),
  ('@mushi-mushi/svelte', '0.7.0', false, now()),
  ('@mushi-mushi/angular', '0.7.0', false, now()),
  ('@mushi-mushi/react-native', '0.7.0', false, now())
ON CONFLICT (package, version)
DO UPDATE SET
  deprecated = EXCLUDED.deprecated,
  released_at = EXCLUDED.released_at;

-- Force PostgREST to drop its in-memory schema cache so the new columns and
-- the new table are visible to API callers within seconds, not minutes. The
-- 03:00-UTC retention sweep cron (Sentry MUSHI-MUSHI-SERVER-N) caught a stale
-- cache window after this migration shipped and reported
-- `column reports.created_at does not exist` even though the column has
-- existed since day one — PostgREST had simply not re-read the columns list
-- yet. Both NOTIFYs are needed because PostgREST listens on each.
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
