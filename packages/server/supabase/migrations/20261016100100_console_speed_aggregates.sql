-- ============================================================================
-- Console speed: aggregates in SQL instead of rows counted in the api function
-- (2026-10-16). Additive only: three new functions, service role only.
--
--   1. console_project_counts(p_project_ids)                       NEW
--      Exact per-project counts the setup checklist and /projects show:
--      reports, fix attempts, merged fix attempts, and live indexed files
--      (symbol_name and tombstoned_at both null, setup-signals.ts
--      INDEXED_FILE_ROW). Replaces four head-count HTTP requests per project
--      (52 for 13 projects on one /v1/admin/setup load). A correlated count
--      per project, not a table-wide GROUP BY: the GROUP BY over
--      project_codebase_files took 6.5 s on prod.
--
--   2. dashboard_chart_rollup(p_project_ids, p_since)              NEW
--      Per-UTC-day report intake by severity, per-day LLM calls / tokens /
--      latency / failures, and the top 6 components, for /v1/admin/dashboard.
--      The route read up to 5,000 rows per chart and bucketed them in JS, but
--      PostgREST caps a plain select at 1,000 rows: 14 days held 1,716 LLM
--      invocations on 2026-10-16, so the chart and token total came up short.
--      Days are `(created_at at time zone 'UTC')::date`, the same key as the
--      route's `created_at.slice(0, 10)`.
--
--   3. billing_llm_cost_by_project(p_project_ids, p_since)         NEW
--      Persisted LLM cost per project since p_since for /v1/admin/billing,
--      which summed the same capped row read (1,726 rows this month).
--
-- Each caller falls back to its previous read when the function is missing,
-- so the api may deploy before this migration.
--
-- Apply AFTER the indexes in 20261016100000_console_speed_indexes.sql are
-- built and valid: without the partial project_codebase_files index,
-- console_project_counts took 768 ms on prod (59 ms per project, one after
-- another), slower than the parallel head counts it replaces.
-- ============================================================================

-- ── 1. console_project_counts ───────────────────────────────────────────────
create or replace function public.console_project_counts(p_project_ids uuid[])
returns table (
  project_id uuid,
  report_count bigint,
  fix_count bigint,
  merged_fix_count bigint,
  indexed_file_count bigint
)
language sql
stable
security invoker
set search_path = public
as $cpc$
  select p.pid,
         (select count(*) from public.reports r where r.project_id = p.pid),
         (select count(*) from public.fix_attempts f where f.project_id = p.pid),
         (select count(*) from public.fix_attempts f where f.project_id = p.pid and f.merged_at is not null),
         (select count(*)
            from public.project_codebase_files cf
           where cf.project_id = p.pid
             and cf.symbol_name is null
             and cf.tombstoned_at is null)
    from unnest(p_project_ids) as p(pid);
$cpc$;

comment on function public.console_project_counts(uuid[]) is
  'Exact per-project report, fix attempt, merged fix attempt and live indexed file counts. Service role only (_shared/setup-signals.ts, api/routes/projects-crud.ts).';

revoke all on function public.console_project_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.console_project_counts(uuid[]) to service_role;

-- ── 2. dashboard_chart_rollup ───────────────────────────────────────────────
create or replace function public.dashboard_chart_rollup(
  p_project_ids uuid[],
  p_since timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $dcr$
  select jsonb_build_object(
    'report_days', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.day)
        from (
          select (r.created_at at time zone 'UTC')::date as day,
                 count(*) as total,
                 count(*) filter (where lower(coalesce(r.severity, '')) = 'critical') as critical,
                 count(*) filter (where lower(coalesce(r.severity, '')) = 'high') as high,
                 count(*) filter (where lower(coalesce(r.severity, '')) = 'medium') as medium,
                 count(*) filter (where lower(coalesce(r.severity, '')) = 'low') as low,
                 count(*) filter (
                   where lower(coalesce(r.severity, '')) not in ('critical', 'high', 'medium', 'low')
                 ) as unscored
            from public.reports r
           where r.project_id = any(p_project_ids)
             and r.created_at >= p_since
           group by 1
        ) d
    ), '[]'::jsonb),
    'llm_days', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.day)
        from (
          select (l.created_at at time zone 'UTC')::date as day,
                 count(*) as calls,
                 coalesce(sum(coalesce(l.input_tokens, 0)::bigint + coalesce(l.output_tokens, 0)), 0) as tokens,
                 coalesce(sum(coalesce(l.latency_ms, 0)::bigint), 0) as latency_ms,
                 count(*) filter (where l.status is distinct from 'success') as failures
            from public.llm_invocations l
           where l.project_id = any(p_project_ids)
             and l.created_at >= p_since
           group by 1
        ) d
    ), '[]'::jsonb),
    -- Ties keep the route's old order: the component seen most recently first.
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('component', c.component, 'count', c.n) order by c.n desc, c.newest desc)
        from (
          select btrim(r.component, E' \t\r\n') as component,
                 count(*) as n,
                 max(r.created_at) as newest
            from public.reports r
           where r.project_id = any(p_project_ids)
             and r.created_at >= p_since
             and btrim(coalesce(r.component, ''), E' \t\r\n') <> ''
           group by 1
           order by n desc, newest desc
           limit 6
        ) c
    ), '[]'::jsonb)
  );
$dcr$;

comment on function public.dashboard_chart_rollup(uuid[], timestamptz) is
  'Per-UTC-day report and LLM buckets plus the top 6 components since p_since. Service role only (_shared/dashboard-chart-rollup.ts).';

revoke all on function public.dashboard_chart_rollup(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.dashboard_chart_rollup(uuid[], timestamptz) to service_role;

-- ── 3. billing_llm_cost_by_project ──────────────────────────────────────────
create or replace function public.billing_llm_cost_by_project(
  p_project_ids uuid[],
  p_since timestamptz
)
returns table (project_id uuid, cost_usd numeric)
language sql
stable
security invoker
set search_path = public
as $blc$
  select l.project_id, sum(l.cost_usd) as cost_usd
    from public.llm_invocations l
   where l.project_id = any(p_project_ids)
     and l.created_at >= p_since
     and l.cost_usd is not null
   group by l.project_id;
$blc$;

comment on function public.billing_llm_cost_by_project(uuid[], timestamptz) is
  'Persisted LLM cost per project since p_since. Service role only (api/routes/billing.ts).';

revoke all on function public.billing_llm_cost_by_project(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.billing_llm_cost_by_project(uuid[], timestamptz) to service_role;
