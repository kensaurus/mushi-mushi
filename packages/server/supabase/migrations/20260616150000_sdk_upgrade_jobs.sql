-- SDK upgrade job queue.
-- Tracks one-click "Create Upgrade PR" requests from the Mushi console.
-- Mirrors the shape of fix_dispatch_jobs so the same SSE-polling pattern works.
--
-- RLS: service-role only (reads come through the /v1/admin API layer).

CREATE TABLE IF NOT EXISTS public.sdk_upgrade_jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'queued'
                CONSTRAINT sdk_upgrade_jobs_status_check
                  CHECK (status IN ('queued','running','completed','completed_no_pr','failed','cancelled')),
  -- Result columns (populated by the worker on success)
  pr_url        text,
  pr_number     int,
  branch        text,
  commit_sha    text,
  -- Per-package bump plan as JSON: [{ package, from, to }]
  plan          jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

CREATE INDEX IF NOT EXISTS sdk_upgrade_jobs_project_status_idx
  ON public.sdk_upgrade_jobs (project_id, status)
  WHERE status IN ('queued', 'running');

-- RLS on: callers must go through the API
ALTER TABLE public.sdk_upgrade_jobs ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (edge workers)
CREATE POLICY "service_role_all" ON public.sdk_upgrade_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No anon / authenticated policies — the API layer enforces project membership.

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
