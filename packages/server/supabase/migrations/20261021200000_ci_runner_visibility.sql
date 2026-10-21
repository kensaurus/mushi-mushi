-- ============================================================================
-- 20261021200000_ci_runner_visibility
--
-- CI runners you can see (Plan 022, ADR 0033). On 2026-10-21 glot.it's
-- self-hosted runner was OOM-killed; GitHub cancelled the job and Mushi read
-- it as "CI failed". Mushi already fetched each job's runner and timing and
-- threw it away. This keeps it:
--
--   ci_jobs                one row per GitHub job attempt (30 days), with
--                          the infra verdict of _shared/ci-infra.ts
--   ci_runners             runners per project + repo, from the runner list
--                          (Administration: read) or seen in jobs
--   ci_runner_hosts        host heartbeats from `mushi runner heartbeat`
--                          (per organization; host_id is a sha256, never a
--                          raw machine id)
--   ci_runner_job_samples  per-job memory samples from runner job hooks (30 days)
--   ci_collector_state     per project: which GitHub permissions the token
--                          has, and the live-sync throttle
--   fix_attempts.ci_infra  the latest verdict for the attempt's PR head
--
-- Retention: the ci-jobs-collector deletes ci_jobs and ci_runner_job_samples
-- older than 30 days at the end of each tick (bounded batches).
--
-- Host telemetry comes in on a narrow key scope, `runner:write` (the
-- voice:write precedent, 20260912001000): POST /v1/ingest/runner accepts it
-- and nothing else does. The public SDK key (report:write, shipped in app
-- bundles) must not be able to write the CI view, and an mcp:write key must
-- not have to sit on a runner, where CI jobs run as the same user.
--
-- ADDITIVE: five tables, one column, one claim function, one cron job, one
-- appended project_api_keys.scopes value ('runner:write').
-- Apply BEFORE deploying ci-sync, ci-jobs-collector, webhooks-github-indexer
-- and the api function.
-- ============================================================================

-- project_api_keys.scopes: allow 'runner:write'. Every value the CHECK
-- allowed before (20260912001000) is kept.
ALTER TABLE public.project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid;

ALTER TABLE public.project_api_keys
  ADD CONSTRAINT project_api_keys_scopes_valid
  CHECK (
    scopes <@ array['report:write', 'mcp:read', 'mcp:write', 'activity:write', 'rewards:read', 'voice:write', 'runner:write']::text[]
    AND cardinality(scopes) > 0
  );

-- api_key_has_scope(text[], text) is unchanged: `ELSE p_required = ANY(p_scopes)`
-- grants 'runner:write' only when the key carries it. Refresh the comment only.
COMMENT ON FUNCTION public.api_key_has_scope(text[], text) IS
  'True iff p_scopes grants p_required. mcp:write implies mcp:read. Other scopes (activity:write, rewards:read, voice:write, runner:write) must be present verbatim.';

ALTER TABLE public.fix_attempts
  ADD COLUMN IF NOT EXISTS ci_infra jsonb;

COMMENT ON COLUMN public.fix_attempts.ci_infra IS
  'Latest CI verdict for the PR head (Plan 022): {kind, infra, job, runner, queuedSeconds, detail, runId, at}. infra=true means the test machine failed (runner lost, queue expired, waiting for a runner), not the code. NULL when CI is green or unread. Written by ci-sync and webhooks-github-indexer.';

-- ── ci_jobs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo               text NOT NULL CHECK (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  run_id             bigint NOT NULL,
  run_attempt        integer NOT NULL DEFAULT 1 CHECK (run_attempt >= 1),
  job_id             bigint NOT NULL,
  workflow_name      text,
  job_name           text NOT NULL,
  event              text,
  head_branch        text,
  head_sha           text,
  pr_number          integer,
  status             text NOT NULL
                       CHECK (status IN ('queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending')),
  conclusion         text,
  gh_created_at      timestamptz NOT NULL,
  started_at         timestamptz,
  completed_at       timestamptz,
  queue_seconds      integer,
  duration_seconds   integer,
  runner_name        text,
  runner_group_name  text,
  runner_labels      text[] NOT NULL DEFAULT '{}',
  runner_kind        text NOT NULL DEFAULT 'unknown'
                       CHECK (runner_kind IN ('self_hosted', 'github_hosted', 'unknown')),
  ci_kind            text NOT NULL
                       CHECK (ci_kind IN ('passed', 'skipped', 'running', 'queued', 'waiting_for_runner', 'runner_lost', 'queue_expired', 'cancelled', 'code_failure')),
  infra              boolean NOT NULL DEFAULT false,
  infra_detail       text,
  -- [{name, conclusion, seconds}], at most 40.
  steps              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array'),
  html_url           text,
  source             text NOT NULL CHECK (source IN ('poll', 'webhook')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Per project: two projects bound to the same repository each keep the job.
  CONSTRAINT ci_jobs_job_attempt_unique UNIQUE (project_id, job_id, run_attempt)
);

COMMENT ON TABLE public.ci_jobs IS
  'GitHub Actions jobs per project (Plan 022): timing, runner, and the infra-vs-code verdict (ci_kind, infra). Kept 30 days. Written by ci-jobs-collector, ci-sync, the api live sync and the workflow_job webhook (service role); read by GET /v1/admin/ci/overview.';

CREATE INDEX IF NOT EXISTS idx_ci_jobs_project_created
  ON public.ci_jobs (project_id, gh_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ci_jobs_repo_runner
  ON public.ci_jobs (repo, runner_name);
CREATE INDEX IF NOT EXISTS idx_ci_jobs_project_head
  ON public.ci_jobs (project_id, head_sha);
CREATE INDEX IF NOT EXISTS idx_ci_jobs_unfinished
  ON public.ci_jobs (project_id, gh_created_at DESC)
  WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS idx_ci_jobs_created
  ON public.ci_jobs (gh_created_at);

-- ── ci_runners ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_runners (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo           text NOT NULL CHECK (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  runner_name    text NOT NULL CHECK (char_length(runner_name) BETWEEN 1 AND 200),
  runner_id      bigint,
  os             text,
  status         text NOT NULL DEFAULT 'unknown' CHECK (status IN ('online', 'offline', 'unknown')),
  busy           boolean,
  labels         text[] NOT NULL DEFAULT '{}',
  ephemeral      boolean,
  kind           text NOT NULL DEFAULT 'unknown' CHECK (kind IN ('self_hosted', 'github_hosted', 'unknown')),
  source         text NOT NULL CHECK (source IN ('github_api', 'jobs')),
  -- The unknown_runner advice reads this: a new self-hosted runner nobody's heartbeat lists.
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_job_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ci_runners_project_repo_name_unique UNIQUE (project_id, repo, runner_name)
);

COMMENT ON TABLE public.ci_runners IS
  'Runners per project + repo (Plan 022): from GET /repos/{o}/{r}/actions/runners when the token has Administration: read (source github_api), else the runners seen in jobs (source jobs). Service-role writes.';

CREATE INDEX IF NOT EXISTS idx_ci_runners_project
  ON public.ci_runners (project_id, last_seen_at DESC);

-- ── ci_runner_hosts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_runner_hosts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The project whose key last pushed this heartbeat.
  project_id         uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  -- sha256 of the machine id, hashed on the machine; never the raw id.
  host_id            text NOT NULL CHECK (host_id ~ '^[0-9a-f]{64}$'),
  hostname           text NOT NULL CHECK (char_length(hostname) BETWEEN 1 AND 80),
  platform           text NOT NULL CHECK (platform IN ('linux', 'wsl2', 'macos', 'windows')),
  cpu_count          integer CHECK (cpu_count IS NULL OR cpu_count BETWEEN 1 AND 4096),
  mem_total_mb       integer CHECK (mem_total_mb IS NULL OR mem_total_mb >= 0),
  last_heartbeat_at  timestamptz NOT NULL,
  -- {load1, mem_used_mb, swap_used_mb, swap_total_mb, disk_free_gb}
  metrics            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  -- [{name, repo, service, active, restarts, mem_current_mb, mem_max_mb, oom_kills}], at most 40
  runners            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(runners) = 'array'),
  mushi_version      text CHECK (mushi_version IS NULL OR char_length(mushi_version) <= 40),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ci_runner_hosts_org_host_unique UNIQUE (organization_id, host_id)
);

COMMENT ON TABLE public.ci_runner_hosts IS
  'Runner host heartbeats (Plan 022 Phase 3) from `mushi runner heartbeat` via POST /v1/ingest/runner: memory, swap, load, disk, runner services. Opt-in; no file contents, environment values or raw machine ids. Service-role writes.';

CREATE INDEX IF NOT EXISTS idx_ci_runner_hosts_org
  ON public.ci_runner_hosts (organization_id, last_heartbeat_at DESC);

-- ── ci_runner_job_samples ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_runner_job_samples (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  host_id          text NOT NULL CHECK (host_id ~ '^[0-9a-f]{64}$'),
  runner_name      text NOT NULL CHECK (char_length(runner_name) BETWEEN 1 AND 200),
  repo             text NOT NULL CHECK (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  run_id           bigint NOT NULL,
  run_attempt      integer NOT NULL DEFAULT 1 CHECK (run_attempt >= 1),
  job_key          text NOT NULL CHECK (char_length(job_key) BETWEEN 1 AND 200),
  phase            text NOT NULL CHECK (phase IN ('started', 'completed')),
  at               timestamptz NOT NULL,
  mem_peak_mb      integer CHECK (mem_peak_mb IS NULL OR mem_peak_mb >= 0),
  mem_max_mb       integer CHECK (mem_max_mb IS NULL OR mem_max_mb >= 0),
  oom_kills        integer CHECK (oom_kills IS NULL OR oom_kills >= 0),
  swap_used_mb     integer CHECK (swap_used_mb IS NULL OR swap_used_mb >= 0),
  load1            numeric CHECK (load1 IS NULL OR load1 >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- A hook that retries its push records once.
  CONSTRAINT ci_runner_job_samples_once UNIQUE (organization_id, host_id, job_key, phase)
);

COMMENT ON TABLE public.ci_runner_job_samples IS
  'Per-job samples from runner job hooks (Plan 022 Phase 3): cgroup memory peak and OOM kills per job. Kept 30 days. Service-role writes.';

CREATE INDEX IF NOT EXISTS idx_ci_runner_job_samples_org_at
  ON public.ci_runner_job_samples (organization_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_ci_runner_job_samples_job
  ON public.ci_runner_job_samples (repo, run_id, run_attempt, runner_name);
CREATE INDEX IF NOT EXISTS idx_ci_runner_job_samples_at
  ON public.ci_runner_job_samples (at);

-- ── ci_collector_state ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_collector_state (
  project_id         uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  -- {"owner/repo": {"jobs": "ok|missing|unknown", "runners": "ok|missing|unknown", "checkedAt": "..."}}
  permissions        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
  last_collected_at  timestamptz,
  -- The overview's live sync claims this (ci_claim_live_sync) at most once a minute.
  last_live_sync_at  timestamptz,
  last_error         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ci_collector_state IS
  'Per project: the GitHub permissions the CI collector found (a 403 on the runner list is recorded, not retried every tick) and the throttle of the overview live sync. Service-role writes.';

-- Atomic claim for the overview's live sync: true for exactly one caller per
-- project per interval, so parallel page polls do not stampede GitHub.
CREATE OR REPLACE FUNCTION public.ci_claim_live_sync(p_project_id uuid, p_min_interval_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  INSERT INTO public.ci_collector_state AS s (project_id, last_live_sync_at, updated_at)
  VALUES (p_project_id, now(), now())
  ON CONFLICT (project_id) DO UPDATE
     SET last_live_sync_at = now(), updated_at = now()
   WHERE s.last_live_sync_at IS NULL
      OR s.last_live_sync_at < now() - make_interval(secs => GREATEST(p_min_interval_seconds, 1))
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END
$$;

REVOKE ALL ON FUNCTION public.ci_claim_live_sync(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ci_claim_live_sync(uuid, integer) TO service_role;

-- ── RLS: members read, the service role writes ──────────────────────────────
ALTER TABLE public.ci_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_runners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_runner_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_runner_job_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_collector_state ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ci_jobs', 'ci_runners', 'ci_collector_state'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_member_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
           project_id IN (SELECT id FROM public.projects WHERE owner_id = (SELECT auth.uid()))
           OR (SELECT private.is_project_member(project_id))
         )',
        t || '_member_select', t
      );
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['ci_runner_hosts', 'ci_runner_job_samples'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_member_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT private.is_org_member(organization_id)))',
        t || '_member_select', t
      );
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['ci_jobs', 'ci_runners', 'ci_runner_hosts', 'ci_runner_job_samples', 'ci_collector_state'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_service_write') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service_write', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ── cron: every 10 minutes at :02, :12, …, :52 ──────────────────────────────
-- Before agent-pr-review (3-53/10) reads CI for its prompts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-ci-jobs-collector schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-ci-jobs-collector';

  PERFORM cron.schedule(
    'mushi-ci-jobs-collector',
    '2-52/10 * * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/ci-jobs-collector',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := '{"trigger":"cron"}'::jsonb
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;
