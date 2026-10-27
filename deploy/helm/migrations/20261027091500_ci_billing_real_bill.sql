-- ============================================================================
-- 20261027091500_ci_billing_real_bill
--
-- The real GitHub Actions bill, and the facts behind the new CI cost rules
-- (2026-10-27, follow-up to Plan 022 / ADRs 0033 and 0037). Everything /ci
-- showed about money until now was estimated from job times; this keeps
-- what GitHub actually charged.
--
--   ci_billing_daily   one row per organization × GitHub owner × UTC day ×
--                      repo × SKU from GitHub's billing usage API
--                      (GET /users|organizations/{owner}/settings/billing/usage),
--                      Actions only: quantity, gross, discount and net USD.
--                      source 'api' (the ci-jobs-collector, once a day per
--                      owner, with the project's own GitHub token) or 'cli'
--                      (`mushi runner bill --push`, the user's own gh login).
--                      Unique per (organization, owner, day, repo, SKU):
--                      the organization is part of the key so two Mushi
--                      organizations that both read one GitHub owner never
--                      overwrite each other's rows.
--   ci_billing_sync    per organization × owner: the last attempt, the last
--                      good read, the plain reason the last read failed, and
--                      `covered_from`, the first day held without a gap.
--   ci_pull_requests   per project × repo × PR: closed / merged state, draft,
--                      head branch, and whether every changed file is
--                      documentation (`docs_only`, from the PR's file list,
--                      read for a few PRs per tick). Kept 30 days like ci_jobs.
--   ci_cost_facts()    one jsonb aggregate of ci_jobs over a window for the
--                      cost rules of GET /v1/admin/ci/compare: billed minutes
--                      per workflow job × event × branch kind (default
--                      branch, Mushi agent branch, other) × runner class × OS;
--                      per pull request × workflow; and per GitHub-hosted job
--                      step. The TypeScript mirror is aggregateCostFacts in
--                      _shared/ci-cost-facts.ts (the tested spec and the
--                      fallback until this is applied); change both together.
--
-- Agent branches (isMushiAgentBranch in _shared/ci-billing.ts):
--   <user>/MUSHI-…-local-cursor, cursor/mushi-fix-…, mushi/…
--
-- Billing rows are an owner's whole Actions bill, so members of the
-- organization read them (like ci_cost_settings and the runner hosts);
-- ci_pull_requests follows ci_jobs (project owner or member). Writes are
-- service role only. ci_cost_facts is SECURITY INVOKER, search_path '', and
-- only service_role may EXECUTE: the api scopes project_ids to the caller.
--
-- ADDITIVE: three tables, one function. Apply before deploying api-ext and
-- ci-jobs-collector (both degrade without it: the bill reads empty, the new
-- cost rules stay silent, the collector skips billing and PR reads).
-- ============================================================================

-- ── ci_billing_daily ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_billing_daily (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The GitHub login the bill belongs to (a user or an organization).
  owner            text NOT NULL CHECK (owner ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  day              date NOT NULL,
  -- owner/repo; '' for usage GitHub does not tie to a repository.
  repo             text NOT NULL DEFAULT '' CHECK (repo = '' OR repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  sku              text NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 100),
  unit             text NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 40),
  quantity         numeric NOT NULL DEFAULT 0,
  gross_usd        numeric NOT NULL DEFAULT 0,
  discount_usd     numeric NOT NULL DEFAULT 0,
  net_usd          numeric NOT NULL DEFAULT 0,
  source           text NOT NULL CHECK (source IN ('api', 'cli')),
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ci_billing_daily_once UNIQUE (organization_id, owner, day, repo, sku)
);

COMMENT ON TABLE public.ci_billing_daily IS
  'The real GitHub Actions bill per organization × GitHub owner × UTC day × repo × SKU, from the billing usage API (source api: ci-jobs-collector daily; cli: mushi runner bill --push). USD as GitHub reports it: gross, discount (included minutes, public repos), net. Read by GET /v1/admin/ci/bill.';

CREATE INDEX IF NOT EXISTS idx_ci_billing_daily_org_day
  ON public.ci_billing_daily (organization_id, day DESC);

-- ── ci_billing_sync ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_billing_sync (
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner            text NOT NULL CHECK (owner ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  owner_type       text CHECK (owner_type IN ('User', 'Organization')),
  last_attempt_at  timestamptz,
  last_ok_at       timestamptz,
  -- Plain words for the console, e.g. the token cannot read billing.
  last_error       text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  last_source      text CHECK (last_source IN ('api', 'cli')),
  -- The first day of the bill held without a gap up to the last good read.
  covered_from     date,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, owner)
);

COMMENT ON TABLE public.ci_billing_sync IS
  'Per organization × GitHub owner: when the Actions bill was last read, the last good read, why the last read failed (plain words), and covered_from (the first day held without a gap). A refused read is retried once a day.';

-- ── ci_pull_requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_pull_requests (
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo              text NOT NULL CHECK (repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  number            integer NOT NULL CHECK (number > 0),
  state             text NOT NULL CHECK (state IN ('open', 'closed')),
  merged            boolean NOT NULL DEFAULT false,
  draft             boolean NOT NULL DEFAULT false,
  head_ref          text,
  closed_at         timestamptz,
  -- True when every changed file is documentation; null until the file list is read.
  docs_only         boolean,
  files_checked_at  timestamptz,
  gh_updated_at     timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, repo, number)
);

COMMENT ON TABLE public.ci_pull_requests IS
  'Pull requests whose CI Mushi prices (cost rules abandoned_pr_minutes, missing_path_filter): closed/merged state, draft, head branch, docs_only from the changed files. Kept 30 days. Written by ci-jobs-collector (service role).';

CREATE INDEX IF NOT EXISTS idx_ci_pull_requests_closed
  ON public.ci_pull_requests (project_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ci_pull_requests_updated
  ON public.ci_pull_requests (updated_at);

-- ── RLS: members read, the service role writes ──────────────────────────────
ALTER TABLE public.ci_billing_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_billing_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_pull_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ci_billing_daily', 'ci_billing_sync'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_member_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT private.is_org_member(organization_id)))',
        t || '_member_select', t
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ci_pull_requests' AND policyname = 'ci_pull_requests_member_select') THEN
    CREATE POLICY ci_pull_requests_member_select ON public.ci_pull_requests FOR SELECT TO authenticated USING (
      project_id IN (SELECT id FROM public.projects WHERE owner_id = (SELECT auth.uid()))
      OR (SELECT private.is_project_member(project_id))
    );
  END IF;

  FOREACH t IN ARRAY ARRAY['ci_billing_daily', 'ci_billing_sync', 'ci_pull_requests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_service_write') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t || '_service_write', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ── ci_cost_facts ───────────────────────────────────────────────────────────
-- Runner class and OS follow ci_runner_comparison (20261022050303); billed
-- minutes round each finished job up to a whole minute, at least 1.
CREATE OR REPLACE FUNCTION public.ci_cost_facts(project_ids uuid[], p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
WITH j AS (
  SELECT
    c.project_id,
    c.repo,
    COALESCE(c.workflow_name, '(unnamed workflow)') AS workflow_name,
    c.job_name,
    COALESCE(c.event, '') AS event,
    c.pr_number,
    c.run_id,
    c.steps,
    CASE
      WHEN c.head_branch IN ('main', 'master') THEN 'default'
      WHEN c.head_branch ~ '^[^/]+/MUSHI-.*-local-cursor$'
        OR c.head_branch LIKE 'cursor/mushi-fix-%'
        OR c.head_branch LIKE 'mushi/%' THEN 'agent'
      ELSE 'other'
    END AS branch_kind,
    CASE
      WHEN c.runner_kind IN ('self_hosted', 'github_hosted') THEN c.runner_kind
      WHEN EXISTS (SELECT 1 FROM unnest(c.runner_labels) l WHERE lower(btrim(l)) = 'self-hosted') THEN 'self_hosted'
      WHEN c.runner_name ~* '^GitHub Actions [0-9]+$' THEN 'github_hosted'
      WHEN NULLIF(btrim(c.runner_group_name), '') IS NOT NULL THEN
        CASE WHEN lower(btrim(c.runner_group_name)) = 'github actions' THEN 'github_hosted' ELSE 'self_hosted' END
      WHEN cardinality(c.runner_labels) > 0
       AND NOT EXISTS (SELECT 1 FROM unnest(c.runner_labels) l WHERE btrim(l) !~* '^(ubuntu|windows|macos)-[A-Za-z0-9_.-]+$') THEN 'github_hosted'
      ELSE 'unknown'
    END AS cls,
    CASE
      WHEN EXISTS (SELECT 1 FROM unnest(COALESCE(c.runner_labels, '{}'::text[]) || COALESCE(c.runner_name, '')) n
                    WHERE lower(n) LIKE 'macos%' OR lower(n) LIKE '%-macos%') THEN 'macos'
      WHEN EXISTS (SELECT 1 FROM unnest(COALESCE(c.runner_labels, '{}'::text[]) || COALESCE(c.runner_name, '')) n
                    WHERE lower(n) LIKE 'windows%' OR lower(n) LIKE '%-windows%') THEN 'windows'
      ELSE 'linux'
    END AS os,
    CASE WHEN c.status = 'completed' AND c.started_at IS NOT NULL AND c.duration_seconds IS NOT NULL AND c.duration_seconds >= 0
      THEN GREATEST(1, ceil(c.duration_seconds / 60.0))::integer
      ELSE 0
    END AS billed
  FROM public.ci_jobs c
  WHERE c.project_id = ANY (project_ids)
    AND c.gh_created_at >= p_from
    AND c.gh_created_at <= p_to
),
e AS (
  SELECT project_id, repo, workflow_name, job_name, event, branch_kind, cls, os,
    count(*) AS jobs,
    count(DISTINCT run_id) AS runs,
    COALESCE(sum(billed), 0) AS billed_minutes
  FROM j
  GROUP BY project_id, repo, workflow_name, job_name, event, branch_kind, cls, os
),
p AS (
  SELECT project_id, repo, pr_number, workflow_name, cls, os,
    count(*) AS jobs,
    COALESCE(sum(billed), 0) AS billed_minutes
  FROM j
  WHERE pr_number IS NOT NULL AND billed > 0
  GROUP BY project_id, repo, pr_number, workflow_name, cls, os
),
s AS (
  SELECT j.project_id, j.repo, j.workflow_name, j.job_name, j.os, st->>'name' AS step_name,
    count(*) AS runs,
    sum((st->>'seconds')::numeric) AS seconds
  FROM j
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.steps) = 'array' THEN j.steps ELSE '[]'::jsonb END) AS st
  WHERE j.cls = 'github_hosted'
    AND jsonb_typeof(st) = 'object'
    AND COALESCE(st->>'name', '') <> ''
    AND COALESCE(st->>'seconds', '') ~ '^[0-9]+(\.[0-9]+)?$'
  GROUP BY j.project_id, j.repo, j.workflow_name, j.job_name, j.os, st->>'name'
)
SELECT jsonb_build_object(
  'events', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'project_id', e.project_id, 'repo', e.repo, 'workflow_name', e.workflow_name, 'job_name', e.job_name,
      'event', e.event, 'branch_kind', e.branch_kind, 'runner_class', e.cls, 'os', e.os,
      'jobs', e.jobs, 'runs', e.runs, 'billed_minutes', e.billed_minutes))
    FROM e
  ), '[]'::jsonb),
  'prs', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'project_id', p.project_id, 'repo', p.repo, 'pr_number', p.pr_number, 'workflow_name', p.workflow_name,
      'runner_class', p.cls, 'os', p.os, 'jobs', p.jobs, 'billed_minutes', p.billed_minutes))
    FROM p
  ), '[]'::jsonb),
  'steps', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'project_id', s.project_id, 'repo', s.repo, 'workflow_name', s.workflow_name, 'job_name', s.job_name,
      'os', s.os, 'step_name', s.step_name, 'runs', s.runs, 'seconds', s.seconds))
    FROM s
  ), '[]'::jsonb),
  'jobs', (SELECT count(*) FROM j)
);
$fn$;

COMMENT ON FUNCTION public.ci_cost_facts(uuid[], timestamptz, timestamptz) IS
  'CI cost rule facts over ci_jobs for GET /v1/admin/ci/compare and /bill: billed minutes per workflow job × event × branch kind (default / agent / other) × runner class × OS, per pull request × workflow, and per GitHub-hosted step. Mirrors aggregateCostFacts in _shared/ci-cost-facts.ts. service_role only; the api scopes project_ids.';

REVOKE ALL ON FUNCTION public.ci_cost_facts(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ci_cost_facts(uuid[], timestamptz, timestamptz) TO service_role;
