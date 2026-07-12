-- Curated SDK version observations per project.
-- Replaces the fragile "latest report by created_at" heuristic: unstamped
-- reports (admin tests, legacy ingest) can no longer mask valid observations.

CREATE TABLE IF NOT EXISTS public.project_sdk_observations (
  project_id    uuid        PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  sdk_package   text        NOT NULL,
  sdk_version   text        NOT NULL,
  source        text        NOT NULL,
  observed_at   timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_sdk_observations_source_check
    CHECK (source IN ('report', 'heartbeat', 'repo_scan', 'upgrade_verify')),
  CONSTRAINT project_sdk_observations_package_check
    CHECK (sdk_package <> ''),
  CONSTRAINT project_sdk_observations_version_check
    CHECK (sdk_version <> '')
);

CREATE INDEX IF NOT EXISTS project_sdk_observations_package_idx
  ON public.project_sdk_observations (sdk_package);

ALTER TABLE public.project_sdk_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.project_sdk_observations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Backfill from the most recent stamped report per project.
INSERT INTO public.project_sdk_observations (project_id, sdk_package, sdk_version, source, observed_at)
SELECT DISTINCT ON (project_id)
  project_id,
  sdk_package,
  sdk_version,
  'report',
  created_at
FROM public.reports
WHERE sdk_package IS NOT NULL
  AND sdk_version IS NOT NULL
  AND sdk_version <> 'seed'
ORDER BY project_id, created_at DESC
ON CONFLICT (project_id) DO UPDATE SET
  sdk_package   = EXCLUDED.sdk_package,
  sdk_version   = EXCLUDED.sdk_version,
  source        = EXCLUDED.source,
  observed_at   = EXCLUDED.observed_at,
  updated_at    = now()
WHERE EXCLUDED.observed_at >= public.project_sdk_observations.observed_at;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
