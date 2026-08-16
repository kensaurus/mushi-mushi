-- Add `last_seen_at` to org_portfolio_summary so the Overview page can tell
-- "healthy" apart from "never connected".
--
-- Bug this fixes: OverviewPage.healthToneFor() derived project health purely
-- from critical_reports/open_reports. A project that had never once been
-- connected has zero of both, so it rendered a green "Healthy" badge — the
-- console reported the most broken state as the best one. The RPC never joined
-- project_api_keys, so the page had no heartbeat signal available to consult.
--
-- `last_seen_at` = the freshest heartbeat across the project's *live* keys.
-- The liveness filter is `is_active = true`, which mirrors the admin payload
-- exactly: projects-crud.ts derives each key's `revoked` flag as `!is_active`,
-- so the frontend's `!key.revoked && key.is_active !== false` test and this
-- predicate select the same rows. Keep the two in sync if either changes.
--
-- NULL is meaningful and distinct from an absent key: it means "this project
-- has no live key that has ever authenticated". The frontend treats an absent
-- field (this migration not yet deployed) as "unknown / render no claim", and
-- an explicit null as "not connected".
--
-- Everything else is copied verbatim from
-- 20260716040000_fix_org_portfolio_summary_no_display_name.sql.
create or replace function org_portfolio_summary(
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz := now() - interval '7 days';
  v_result jsonb;
begin
  with projects_for_org as (
    select id, name, slug, created_at
    from projects
    where organization_id = p_org_id
  ),
  per_project as (
    select
      p.id,
      p.name,
      p.name as label,
      p.slug,
      coalesce((
        select count(*)
        from end_user_sessions s
        where s.project_id = p.id and s.started_at >= v_window_start
      ), 0) as sessions_7d,
      coalesce((
        select count(distinct reporter_token_hash)
        from end_user_sessions s
        where s.project_id = p.id and s.started_at >= v_window_start
      ), 0) as users_7d,
      coalesce((
        select count(*)
        from reports r
        where r.project_id = p.id and r.status in ('new','classified','fixing')
      ), 0) as open_reports,
      coalesce((
        select count(*)
        from reports r
        where r.project_id = p.id
          and r.status in ('new','classified','fixing')
          and r.severity = 'critical'
      ), 0) as critical_reports,
      (select max(created_at) from reports where project_id = p.id) as last_report_at,
      -- Freshest SDK heartbeat across this project's live API keys.
      (
        select max(k.last_seen_at)
        from project_api_keys k
        where k.project_id = p.id
          and k.is_active = true
      ) as last_seen_at,
      coalesce((
        select jsonb_agg(jsonb_build_object('day', d, 'dau', c) order by d)
        from (
          select date_trunc('day', started_at)::date as d,
                 count(distinct reporter_token_hash)  as c
          from end_user_sessions
          where project_id = p.id and started_at >= v_window_start
          group by 1
        ) spark
      ), '[]'::jsonb) as dau_spark
    from projects_for_org p
  )
  select into v_result jsonb_agg(
    jsonb_build_object(
      'project_id',       pp.id,
      'name',             pp.name,
      'label',            pp.label,
      'slug',             pp.slug,
      'sessions_7d',      pp.sessions_7d,
      'users_7d',         pp.users_7d,
      'open_reports',     pp.open_reports,
      'critical_reports', pp.critical_reports,
      'last_report_at',   pp.last_report_at,
      'last_seen_at',     pp.last_seen_at,
      'dau_spark',        pp.dau_spark
    )
  )
  from per_project pp;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

REVOKE EXECUTE ON FUNCTION public.org_portfolio_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_portfolio_summary(uuid) TO authenticated, service_role;
