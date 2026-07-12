-- SDK Release Cockpit lifecycle state.
-- Extends the existing service-role-only sdk_upgrade_jobs queue from
-- "PR opened" into "PR -> CI -> merge -> deploy -> SDK observed".

ALTER TABLE public.sdk_upgrade_jobs
  ADD COLUMN IF NOT EXISTS pr_state text,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merge_method text NOT NULL DEFAULT 'squash',
  ADD COLUMN IF NOT EXISTS merge_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merge_error text,
  ADD COLUMN IF NOT EXISTS check_run_status text,
  ADD COLUMN IF NOT EXISTS check_run_conclusion text,
  ADD COLUMN IF NOT EXISTS check_run_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deploy_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS deploy_url text,
  ADD COLUMN IF NOT EXISTS deploy_environment text,
  ADD COLUMN IF NOT EXISTS deploy_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_sdk_version text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sdk_upgrade_jobs_pr_state_check'
      AND conrelid = 'public.sdk_upgrade_jobs'::regclass
  ) THEN
    ALTER TABLE public.sdk_upgrade_jobs
      ADD CONSTRAINT sdk_upgrade_jobs_pr_state_check
      CHECK (pr_state IS NULL OR pr_state IN ('open', 'draft', 'merged', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sdk_upgrade_jobs_merge_method_check'
      AND conrelid = 'public.sdk_upgrade_jobs'::regclass
  ) THEN
    ALTER TABLE public.sdk_upgrade_jobs
      ADD CONSTRAINT sdk_upgrade_jobs_merge_method_check
      CHECK (merge_method IN ('merge', 'squash', 'rebase'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sdk_upgrade_jobs_deploy_status_check'
      AND conrelid = 'public.sdk_upgrade_jobs'::regclass
  ) THEN
    ALTER TABLE public.sdk_upgrade_jobs
      ADD CONSTRAINT sdk_upgrade_jobs_deploy_status_check
      CHECK (deploy_status IN ('unknown', 'pending', 'success', 'failure', 'waiting'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sdk_upgrade_jobs_release_status_check'
      AND conrelid = 'public.sdk_upgrade_jobs'::regclass
  ) THEN
    ALTER TABLE public.sdk_upgrade_jobs
      ADD CONSTRAINT sdk_upgrade_jobs_release_status_check
      CHECK (
        release_status IS NULL OR release_status IN (
          'pr_opened',
          'blocked',
          'ready_to_merge',
          'merging',
          'merged',
          'deploying',
          'deployed',
          'verified',
          'failed'
        )
      );
  END IF;
END $$;

UPDATE public.sdk_upgrade_jobs
SET release_status = CASE
  WHEN verified_at IS NOT NULL THEN 'verified'
  WHEN deploy_status = 'success' THEN 'deployed'
  WHEN merged_at IS NOT NULL OR pr_state = 'merged' THEN 'merged'
  WHEN status = 'completed' AND pr_url IS NOT NULL THEN 'pr_opened'
  WHEN status = 'completed_no_pr' THEN 'verified'
  WHEN status = 'failed' THEN 'failed'
  ELSE release_status
END
WHERE release_status IS NULL;

CREATE INDEX IF NOT EXISTS sdk_upgrade_jobs_release_status_idx
  ON public.sdk_upgrade_jobs (release_status, finished_at)
  WHERE release_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS sdk_upgrade_jobs_pr_lookup_idx
  ON public.sdk_upgrade_jobs (project_id, pr_number)
  WHERE pr_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS sdk_upgrade_jobs_sync_idx
  ON public.sdk_upgrade_jobs (project_id, release_status, check_run_updated_at)
  WHERE status = 'completed' AND pr_url IS NOT NULL;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
