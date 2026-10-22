-- ============================================================================
-- 20261022120000_ci_cost_compare
--
-- Choose where CI runs, see cost and speed (Plan 022 Phase 7, ADR 0037).
-- Read-only: nothing here writes to GitHub.
--
--   ci_cost_settings       per organization: your electricity figures (idle
--                          and load watts, price per kWh, currency and
--                          exchange rate), wear per busy hour, the GitHub plan
--                          and its included minutes, GitHub's self-hosted
--                          platform fee (default 0: postponed), and which
--                          runners share one physical machine
--   ci_runner_comparison   one jsonb aggregate of ci_jobs over a window for
--                          GET /v1/admin/ci/compare: per repo × runner class
--                          × OS × runner (one-job runners folded) the wait and
--                          run percentiles, PR-only pass rate, infra rate,
--                          raw and billed minutes (each job rounded up to a
--                          whole minute, at least 1), re-runs, tiny jobs; per
--                          job the passed-run medians for speed factors; per
--                          workflow job the billed minutes, with main and
--                          Dependabot apart; and each self-hosted runner's
--                          job intervals merged, so parallel jobs count once
--
-- The overview reads at most 1,000 jobs (PostgREST max_rows); 30 days of
-- jobs is more, so the comparison aggregates in the database. The TypeScript
-- mirror is `aggregateCiJobs` in _shared/ci-compare.ts (the tested spec and
-- the fallback until this is applied); change both together.
--
-- Runner class follows _shared/ci-infra.ts runnerKindOf: the stored kind,
-- else the runner group ("GitHub Actions" = hosted, any other group =
-- self-hosted), else GitHub-hosted labels. Rows stored before 2026-10-22 say
-- 'unknown' for `runs-on: kensaurus-local`; this reads them right without
-- rewriting them.
--
-- SECURITY INVOKER, search_path ''. Only service_role may EXECUTE: the api
-- scopes project_ids to the caller before calling it. It calls only built-in
-- functions, so no role is ever refused EXECUTE inside it.
--
-- ADDITIVE: one table, one function. Apply before deploying api-ext.
-- ============================================================================

-- ── ci_cost_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ci_cost_settings (
  organization_id                 uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  currency                        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- price_per_kwh and wear_per_hour are in `currency` (31 JPY/kWh is ordinary).
  -- Units of `currency` per US dollar (GitHub prices are in USD). 1 for USD.
  fx_per_usd                      numeric NOT NULL DEFAULT 1 CHECK (fx_per_usd > 0 AND fx_per_usd <= 100000),
  watts_idle                      numeric NOT NULL DEFAULT 30 CHECK (watts_idle >= 0 AND watts_idle <= 5000),
  watts_load                      numeric NOT NULL DEFAULT 180 CHECK (watts_load >= 0 AND watts_load <= 5000),
  price_per_kwh                   numeric NOT NULL DEFAULT 0.2 CHECK (price_per_kwh >= 0 AND price_per_kwh <= 1000),
  wear_per_hour                   numeric NOT NULL DEFAULT 0 CHECK (wear_per_hour >= 0 AND wear_per_hour <= 10000),
  plan                            text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team', 'enterprise', 'custom')),
  included_minutes                integer NOT NULL DEFAULT 2000 CHECK (included_minutes >= 0 AND included_minutes <= 1000000),
  self_hosted_fee_per_minute_usd  numeric NOT NULL DEFAULT 0 CHECK (self_hosted_fee_per_minute_usd >= 0 AND self_hosted_fee_per_minute_usd <= 1),
  -- [{name, runners: [runner name or prefix], wattsIdle?, wattsLoad?}], at most 20
  machines                        jsonb NOT NULL DEFAULT '[]'::jsonb
                                    CHECK (jsonb_typeof(machines) = 'array' AND jsonb_array_length(machines) <= 20),
  updated_by                      uuid,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ci_cost_settings_load_at_least_idle CHECK (watts_load >= watts_idle)
);

COMMENT ON TABLE public.ci_cost_settings IS
  'Plan 022 Phase 7 (ADR 0037): per organization, the figures behind CI cost estimates on /ci: electricity (watts idle/load, price per kWh, currency + fx per USD), wear per busy hour, GitHub plan and included minutes, self-hosted platform fee (default 0), and runners grouped by physical machine. Written only by PUT /v1/admin/ci/cost-settings (console session, non-viewer, audited).';

ALTER TABLE public.ci_cost_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ci_cost_settings_member_select ON public.ci_cost_settings;
CREATE POLICY ci_cost_settings_member_select
  ON public.ci_cost_settings FOR SELECT
  TO authenticated
  USING ((SELECT private.is_org_member(organization_id)));

DROP POLICY IF EXISTS ci_cost_settings_service_write ON public.ci_cost_settings;
CREATE POLICY ci_cost_settings_service_write
  ON public.ci_cost_settings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.ci_cost_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ci_cost_settings FROM authenticated;
GRANT SELECT ON TABLE public.ci_cost_settings TO authenticated;

-- ── ci_runner_comparison ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ci_runner_comparison(project_ids uuid[], p_from timestamptz, p_to timestamptz)
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
    c.event,
    c.head_branch,
    c.pr_number,
    GREATEST(COALESCE(c.run_attempt, 1), 1) AS run_attempt,
    c.status,
    c.ci_kind,
    c.runner_name,
    COALESCE(c.runner_labels, '{}'::text[]) AS runner_labels,
    c.queue_seconds,
    c.duration_seconds,
    c.started_at,
    c.completed_at,
    c.gh_created_at,
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
    END AS os
  FROM public.ci_jobs c
  WHERE c.project_id = ANY (project_ids)
    AND c.gh_created_at >= p_from
    AND c.gh_created_at <= p_to
),
k AS (
  SELECT
    j.*,
    CASE WHEN j.cls = 'self_hosted' AND j.runner_name IS NOT NULL
      THEN regexp_replace(j.runner_name, '^(.+?)-[0-9]{8,13}(-[a-z0-9]{1,6})?$', '\1', 'i')
    END AS base,
    (j.status = 'completed' AND j.started_at IS NOT NULL AND j.duration_seconds IS NOT NULL) AS ran,
    CASE WHEN j.status = 'completed' AND j.started_at IS NOT NULL AND j.duration_seconds IS NOT NULL AND j.duration_seconds >= 0
      THEN GREATEST(1, ceil(j.duration_seconds / 60.0))::integer
      ELSE 0
    END AS billed,
    (j.event IN ('pull_request', 'pull_request_target') OR j.pr_number IS NOT NULL) AS is_pr
  FROM j
),
g AS (
  SELECT
    project_id, repo, cls, os, base,
    count(*) AS jobs,
    count(*) FILTER (WHERE ci_kind = 'queue_expired') AS expired,
    count(*) FILTER (WHERE status = 'completed' AND ci_kind <> 'skipped') AS finished,
    count(*) FILTER (WHERE status = 'completed' AND ci_kind IN ('runner_lost', 'queue_expired', 'waiting_for_runner')) AS infra,
    count(*) FILTER (WHERE is_pr AND ci_kind IN ('passed', 'code_failure', 'runner_lost', 'queue_expired')) AS pr_counted,
    count(*) FILTER (WHERE is_pr AND ci_kind = 'passed') AS pr_passed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY queue_seconds) FILTER (WHERE started_at IS NOT NULL AND queue_seconds IS NOT NULL) AS queue_p50,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY queue_seconds) FILTER (WHERE started_at IS NOT NULL AND queue_seconds IS NOT NULL) AS queue_p95,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_seconds) FILTER (WHERE ran) AS run_p50,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_seconds) FILTER (WHERE ran) AS run_p95,
    COALESCE(sum(duration_seconds) FILTER (WHERE ran), 0) AS raw_seconds,
    COALESCE(sum(billed), 0) AS billed_minutes,
    count(*) FILTER (WHERE ran AND run_attempt > 1) AS rerun_jobs,
    COALESCE(sum(billed) FILTER (WHERE ran AND run_attempt > 1), 0) AS rerun_billed_minutes,
    count(*) FILTER (WHERE ran AND duration_seconds < 20) AS tiny_jobs,
    COALESCE(sum(duration_seconds) FILTER (WHERE ran AND duration_seconds < 20), 0) AS tiny_raw_seconds
  FROM k
  GROUP BY project_id, repo, cls, os, base
),
gl AS (
  SELECT k.project_id, k.repo, k.cls, k.os, k.base, array_agg(DISTINCT l ORDER BY l) AS labels
  FROM k CROSS JOIN LATERAL unnest(k.runner_labels[1:10]) AS l
  GROUP BY k.project_id, k.repo, k.cls, k.os, k.base
),
p AS (
  SELECT project_id, repo, workflow_name, job_name, cls,
    count(*) AS passed,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_seconds) AS run_p50
  FROM k
  WHERE ran AND ci_kind = 'passed'
  GROUP BY project_id, repo, workflow_name, job_name, cls
),
w AS (
  SELECT project_id, repo, workflow_name, job_name, cls, os, base,
    count(*) AS jobs,
    COALESCE(sum(billed), 0) AS billed_minutes,
    COALESCE(sum(duration_seconds), 0) AS raw_seconds,
    COALESCE(sum(billed) FILTER (WHERE head_branch IN ('main', 'master')), 0) AS main_billed_minutes,
    COALESCE(sum(billed) FILTER (WHERE head_branch LIKE 'dependabot/%'), 0) AS dependabot_billed_minutes
  FROM k
  WHERE ran
  GROUP BY project_id, repo, workflow_name, job_name, cls, os, base
),
wl AS (
  SELECT k.project_id, k.repo, k.workflow_name, k.job_name, k.cls, k.os, k.base, array_agg(DISTINCT l ORDER BY l) AS labels
  FROM k CROSS JOIN LATERAL unnest(k.runner_labels[1:10]) AS l
  WHERE k.ran
  GROUP BY k.project_id, k.repo, k.workflow_name, k.job_name, k.cls, k.os, k.base
),
iv AS (
  SELECT base, started_at AS s, completed_at AS e
  FROM k
  WHERE cls = 'self_hosted' AND base IS NOT NULL AND ran AND completed_at > started_at
),
ivo AS (
  SELECT base, s, e,
    max(e) OVER (PARTITION BY base ORDER BY s, e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_end
  FROM iv
),
ivg AS (
  SELECT base, s, e,
    sum(CASE WHEN prev_end IS NULL OR s > prev_end THEN 1 ELSE 0 END) OVER (PARTITION BY base ORDER BY s, e) AS island
  FROM ivo
),
merged AS (
  SELECT base, min(s) AS s, max(e) AS e
  FROM ivg
  GROUP BY base, island
)
SELECT jsonb_build_object(
  'groups', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'project_id', g.project_id, 'repo', g.repo, 'runner_class', g.cls, 'os', g.os, 'runner_base', g.base,
      'labels', COALESCE(to_jsonb(gl.labels), '[]'::jsonb),
      'jobs', g.jobs, 'expired', g.expired, 'finished', g.finished, 'infra', g.infra,
      'pr_counted', g.pr_counted, 'pr_passed', g.pr_passed,
      'queue_p50', g.queue_p50, 'queue_p95', g.queue_p95, 'run_p50', g.run_p50, 'run_p95', g.run_p95,
      'raw_seconds', g.raw_seconds, 'billed_minutes', g.billed_minutes,
      'rerun_jobs', g.rerun_jobs, 'rerun_billed_minutes', g.rerun_billed_minutes,
      'tiny_jobs', g.tiny_jobs, 'tiny_raw_seconds', g.tiny_raw_seconds))
    FROM g
    LEFT JOIN gl
      ON gl.project_id = g.project_id AND gl.repo = g.repo AND gl.cls = g.cls AND gl.os = g.os
     AND gl.base IS NOT DISTINCT FROM g.base
  ), '[]'::jsonb),
  'pairs', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'project_id', p.project_id, 'repo', p.repo, 'workflow_name', p.workflow_name, 'job_name', p.job_name,
      'runner_class', p.cls, 'passed', p.passed, 'run_p50', p.run_p50))
    FROM p
  ), '[]'::jsonb),
  'workflows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'project_id', w.project_id, 'repo', w.repo, 'workflow_name', w.workflow_name, 'job_name', w.job_name,
      'runner_class', w.cls, 'os', w.os, 'runner_base', w.base,
      'labels', COALESCE(to_jsonb(wl.labels), '[]'::jsonb),
      'jobs', w.jobs, 'billed_minutes', w.billed_minutes, 'raw_seconds', w.raw_seconds,
      'main_billed_minutes', w.main_billed_minutes, 'dependabot_billed_minutes', w.dependabot_billed_minutes))
    FROM w
    LEFT JOIN wl
      ON wl.project_id = w.project_id AND wl.repo = w.repo AND wl.workflow_name = w.workflow_name
     AND wl.job_name = w.job_name AND wl.cls = w.cls AND wl.os = w.os AND wl.base IS NOT DISTINCT FROM w.base
  ), '[]'::jsonb),
  'intervals', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('runner_base', m.base, 'start', m.s, 'end', m.e))
    FROM (SELECT base, s, e FROM merged ORDER BY s DESC LIMIT 5000) m
  ), '[]'::jsonb),
  'oldest', (SELECT min(gh_created_at) FROM j),
  'jobs', (SELECT count(*) FROM j)
);
$fn$;

COMMENT ON FUNCTION public.ci_runner_comparison(uuid[], timestamptz, timestamptz) IS
  'Plan 022 Phase 7: CI cost and speed aggregate over ci_jobs for GET /v1/admin/ci/compare (groups per repo × runner class × OS × runner, passed-run medians, per-workflow-job billed minutes, merged self-hosted intervals). Mirrors aggregateCiJobs in _shared/ci-compare.ts. service_role only; the api scopes project_ids.';

REVOKE ALL ON FUNCTION public.ci_runner_comparison(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ci_runner_comparison(uuid[], timestamptz, timestamptz) TO service_role;
