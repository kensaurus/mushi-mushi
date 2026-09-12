-- Fix org_portfolio_summary: projects has name/slug only — never display_name.
-- Remote error: column "display_name" does not exist (RPC_ERROR) on GET /v1/admin/portfolio.
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
      'dau_spark',        pp.dau_spark
    )
  )
  from per_project pp;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

REVOKE EXECUTE ON FUNCTION public.org_portfolio_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_portfolio_summary(uuid) TO authenticated, service_role;
