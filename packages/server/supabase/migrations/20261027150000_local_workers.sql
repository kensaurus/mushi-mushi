-- ============================================================================
-- 20261027150000_local_workers
--
-- Local workers (ADR 0048, console ops plan P2). The local fix lanes ran for a
-- week as hand-made systemd services around `mushi work`, configured by a text
-- file on the machine (lanes.conf) with a queue per lane in another text file.
-- `mushi work --daemon` replaces them: it registers its machine, sends a
-- heartbeat every 60 s, reads its lanes' settings from the reply and claims
-- reports through a server lease, so the console can see and steer it.
--
--   work_hosts    one row per machine and worker key; host_id is the same
--                 on-machine sha256 as ci_runner_hosts.host_id, never a raw id
--   work_lanes    one lane = one app on one machine: model, mode, concurrency,
--                 paused, stop date, drain. The clone a lane works in stays in
--                 the machine's own config: Mushi never stores or sends a path
--   work_queue    reports a person (or a filed report) put first in a lane
--   work_claims   the lease: one ACTIVE claim per report, 45 min, renewed by
--                 the heartbeat. Every dispatcher (spend-down, fix-worker,
--                 skill-runs) skips a report with an unexpired active claim
--
-- The daemon authenticates with a new narrow key scope, `worker:run`. It
-- reaches the /v1/worker/* routes, the local follow-up routes, report filing,
-- and recording a fix attempt on a report it holds an active claim on. It never
-- reaches merge, settings or keys, and mcp:write does not imply it.
--
-- RLS: service role only. The console reads through /v1/admin/work/* routes.
--
-- ADDITIVE: four tables, one appended project_api_keys.scopes value
-- ('worker:run'). Apply BEFORE deploying api, api-ext, fix-worker,
-- spend-down-worker and skill-runs. Their lease checks read a missing table
-- (42P01 / PGRST205) as "no claims", but any other read error stops a
-- dispatch, so do not rely on the fallback.
-- ============================================================================

-- project_api_keys.scopes: allow 'worker:run'. Every value the CHECK allowed
-- before (20261021111344) is kept.
ALTER TABLE public.project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid;

ALTER TABLE public.project_api_keys
  ADD CONSTRAINT project_api_keys_scopes_valid
  CHECK (
    scopes <@ array['report:write', 'mcp:read', 'mcp:write', 'activity:write', 'rewards:read', 'voice:write', 'runner:write', 'worker:run']::text[]
    AND cardinality(scopes) > 0
  );

-- api_key_has_scope(text[], text) is unchanged: `ELSE p_required = ANY(p_scopes)`
-- grants 'worker:run' only when the key carries it. Refresh the comment only.
COMMENT ON FUNCTION public.api_key_has_scope(text[], text) IS
  'True iff p_scopes grants p_required. mcp:write implies mcp:read. Other scopes (activity:write, rewards:read, voice:write, runner:write, worker:run) must be present verbatim.';

-- ── work_hosts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_hosts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The key's owner: every lane on this host serves apps this user can reach.
  owner_user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The worker:run key the daemon sends. Revoking the key stops the host at
  -- its next heartbeat.
  api_key_id         uuid NOT NULL REFERENCES public.project_api_keys(id) ON DELETE CASCADE,
  -- sha256 of the machine id, hashed on the machine; never the raw id.
  host_id            text NOT NULL CHECK (host_id ~ '^[0-9a-f]{64}$'),
  hostname           text NOT NULL CHECK (char_length(hostname) BETWEEN 1 AND 80),
  platform           text NOT NULL CHECK (platform IN ('linux', 'wsl2', 'macos', 'windows')),
  mushi_version      text CHECK (mushi_version IS NULL OR char_length(mushi_version) <= 40),
  last_heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  -- What the daemon says about itself: {state, agents, maxAgents, memAvailableGb,
  -- ghRemaining, cursor, worktrees, branches}. Numbers and short words only.
  status             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(status) = 'object'),
  -- Guards the daemon applies on the machine, set from the console:
  -- {max_agents, min_free_mem_gb, gh_floor}. Missing keys take lane-v4's
  -- defaults (6 agents, 5 GB free, 800 GitHub calls left).
  guards             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(guards) = 'object'),
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_hosts_key_host_unique UNIQUE (api_key_id, host_id)
);

COMMENT ON TABLE public.work_hosts IS
  'Machines running `mushi work --daemon` (ADR 0048): one row per (worker:run key, sha256 host id). Written by POST /v1/worker/heartbeat; read by the console through GET /v1/admin/work/lanes. Service role only.';

CREATE INDEX IF NOT EXISTS idx_work_hosts_owner
  ON public.work_hosts (owner_user_id, last_heartbeat_at DESC);

-- ── work_lanes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_lanes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id            uuid NOT NULL REFERENCES public.work_hosts(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- The lane's name in the machine's config (lanes.conf style).
  name               text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  -- The closed set of settings the heartbeat returns (ADR 0048). Each is a
  -- value, never a command or a path.
  model              text CHECK (model IS NULL OR model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  mode               text NOT NULL DEFAULT 'fix' CHECK (mode IN ('fix', 'followups')),
  concurrency        integer NOT NULL DEFAULT 1 CHECK (concurrency BETWEEN 1 AND 4),
  paused             boolean NOT NULL DEFAULT false,
  stop_at            timestamptz,
  -- Finish what is running, claim nothing new.
  drain              boolean NOT NULL DEFAULT false,
  -- Remove this worker's own merged or closed worktrees and branches (P4;
  -- accepted and stored now, acted on later).
  prune_own          boolean NOT NULL DEFAULT false,
  -- What the daemon says about the lane: {state, runs, prs, pushes, timeouts,
  -- errors, idle, agentMin, last}. lanectl status, as data.
  status             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(status) = 'object'),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_lanes_host_name_unique UNIQUE (host_id, name)
);

COMMENT ON TABLE public.work_lanes IS
  'Lanes of a local worker (ADR 0048): one app on one machine, with the settings the heartbeat returns (model, mode, concurrency, paused, stop_at, drain, prune_own). Changed from the console (PATCH /v1/admin/work/lanes/:id). Service role only.';

CREATE INDEX IF NOT EXISTS idx_work_lanes_project
  ON public.work_lanes (project_id);

-- ── work_queue ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id            uuid NOT NULL REFERENCES public.work_lanes(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id          uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  -- Lower runs first. A requeue after an infra failure goes before the rest.
  position           integer NOT NULL DEFAULT 0,
  source             text NOT NULL DEFAULT 'console' CHECK (source IN ('console', 'report_file', 'requeue', 'lease_expired')),
  added_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_queue_lane_report_unique UNIQUE (lane_id, report_id)
);

COMMENT ON TABLE public.work_queue IS
  'Reports a local worker lane takes first, in position order (ADR 0048). A claim removes the row. Service role only.';

CREATE INDEX IF NOT EXISTS idx_work_queue_lane_position
  ON public.work_queue (lane_id, position, created_at);

-- ── work_claims ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_claims (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id            uuid NOT NULL REFERENCES public.work_lanes(id) ON DELETE CASCADE,
  host_id            uuid NOT NULL REFERENCES public.work_hosts(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id          uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'expired')),
  from_queue         boolean NOT NULL DEFAULT false,
  claimed_at         timestamptz NOT NULL DEFAULT now(),
  lease_until        timestamptz NOT NULL,
  finished_at        timestamptz,
  -- What the run did (done) or why the lease ended (expired).
  outcome            text CHECK (outcome IS NULL OR outcome IN ('pr_opened', 'no_change', 'verdict', 'timeout', 'skipped', 'stopped', 'failed', 'lease_expired')),
  -- A failure's cause, as ADR 0033 splits CI: 'infra' (the machine, a clone
  -- permission, a hook refusing under load) never counts against the report.
  failure_kind       text CHECK (failure_kind IS NULL OR failure_kind IN ('infra', 'code')),
  -- True when this claim's infra failure put the report back in the queue on
  -- its own. At most one automatic requeue per report a week (ADR 0048).
  auto_requeued      boolean NOT NULL DEFAULT false,
  fix_attempt_id     uuid REFERENCES public.fix_attempts(id) ON DELETE SET NULL,
  pr_url             text,
  detail             text CHECK (detail IS NULL OR char_length(detail) <= 1000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.work_claims IS
  'Leases of local workers on reports (ADR 0048): at most one active claim per report (uq_work_claims_active_report). spend-down-worker, fix-worker, dispatchFixForReport and skill-runs skip a report whose active claim has not expired. Service role only.';

-- Two claimers race on this index: one insert wins, the other gets 23505 and
-- takes the next report.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_claims_active_report
  ON public.work_claims (report_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_work_claims_lane_recent
  ON public.work_claims (lane_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_claims_active_lease
  ON public.work_claims (project_id, lease_until)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_work_claims_report
  ON public.work_claims (report_id, claimed_at DESC);

-- ── RLS: service role only ──────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_hosts', 'work_lanes', 'work_queue', 'work_claims'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service_all', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
