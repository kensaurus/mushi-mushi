-- CI cost fix PRs (ADR 0047, Plan 022 follow-up).
-- One row per "Open fix PR" on a CI cost advice item: the console, CLI
-- (`mushi runner fix`) or MCP (`open_ci_cost_fix`) asks for one workflow edit
-- (_shared/ci-cost-fix.ts) and the ci-cost-fix-worker opens it as a draft PR.
--
-- baseline  the workflow's GitHub-hosted billed minutes per day over the 14
--           days before the request, from ci_jobs (estimated: each job rounded
--           up to a whole minute, as GitHub bills).
-- measured  the same per day after the PR merged (up to 14 days), stored as it
--           is read, because ci_jobs keeps only 30 days.
--
-- RLS: service-role only (reads go through /v1/admin/ci/cost-fixes, which
-- checks project membership), like sdk_upgrade_jobs.

CREATE TABLE IF NOT EXISTS public.ci_cost_fix_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requested_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  repo               text        NOT NULL CHECK (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  workflow_path      text        NOT NULL CHECK (workflow_path ~ '^\.github/workflows/[A-Za-z0-9._/-]+\.ya?ml$' AND workflow_path !~ '\.\.'),
  kind               text        NOT NULL CHECK (kind IN ('add_concurrency', 'skip_drafts', 'weekly_cron', 'ignore_docs_paths')),
  status             text        NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'running', 'pr_opened', 'no_change', 'refused', 'failed')),
  -- The workflow's `name:` (or its path when it has none): how ci_jobs names it.
  workflow_name      text,
  -- What the advice said, for the PR body (at most 2,000 characters each).
  evidence           text        CHECK (evidence IS NULL OR char_length(evidence) <= 2000),
  month_saving_usd   numeric(10, 2) CHECK (month_saving_usd IS NULL OR month_saving_usd >= 0),
  summary            text,
  error_code         text,
  error              text,
  pr_url             text,
  pr_number          integer,
  branch             text,
  commit_sha         text,
  baseline           jsonb       CHECK (baseline IS NULL OR jsonb_typeof(baseline) = 'object'),
  measured           jsonb       CHECK (measured IS NULL OR jsonb_typeof(measured) = 'object'),
  merged_at          timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ci_cost_fix_jobs_project_created_idx
  ON public.ci_cost_fix_jobs (project_id, created_at DESC);

-- One job in flight per workflow edit: a double click queues one PR.
CREATE UNIQUE INDEX IF NOT EXISTS ci_cost_fix_jobs_one_active_idx
  ON public.ci_cost_fix_jobs (project_id, lower(repo), workflow_path, kind)
  WHERE status IN ('queued', 'running');

ALTER TABLE public.ci_cost_fix_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.ci_cost_fix_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No anon / authenticated policies: the API layer enforces project membership.
REVOKE ALL ON public.ci_cost_fix_jobs FROM anon, authenticated;

COMMENT ON TABLE public.ci_cost_fix_jobs IS
  'CI cost "Open fix PR" jobs (ADR 0047): one workflow edit (add_concurrency, skip_drafts, weekly_cron, ignore_docs_paths) opened as a draft PR by ci-cost-fix-worker, with the workflow''s billed minutes per day for 14 days before (baseline) and after the merge (measured). Service-role only.';

NOTIFY pgrst, 'reload schema';
