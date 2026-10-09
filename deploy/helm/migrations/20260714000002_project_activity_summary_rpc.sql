-- project_activity_summary(p_project_id, p_window_days)
-- Returns per-project engagement rollup for the Activity dashboard.
-- Owner-scoped: caller must have already verified project ownership before
-- passing p_project_id (enforced by the edge function layer).
create or replace function project_activity_summary(
  p_project_id uuid,
  p_window_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz := now() - (p_window_days || ' days')::interval;
  v_result jsonb;
begin
  with
  session_stats as (
    select
      count(*)                                                   as total_sessions,
      count(*) filter (where ended_at is not null)              as completed_sessions,
      count(distinct reporter_token_hash)                        as unique_devices,
      count(distinct end_user_id) filter (where end_user_id is not null) as identified_users,
      round(avg(page_view_count))::int                          as avg_page_views,
      round(avg(
        extract(epoch from coalesce(ended_at, last_seen_at) - started_at) / 60.0
      ))::int                                                    as avg_session_minutes
    from end_user_sessions
    where project_id = p_project_id
      and started_at >= v_window_start
  ),
  dau_series as (
    select
      date_trunc('day', started_at) as day,
      count(distinct reporter_token_hash) as dau
    from end_user_sessions
    where project_id = p_project_id
      and started_at >= v_window_start
    group by 1
    order by 1
  ),
  top_routes as (
    select
      route,
      count(*) as views
    from session_page_views
    where project_id = p_project_id
      and ts >= v_window_start
      and route is not null
    group by route
    order by views desc
    limit 10
  ),
  report_counts as (
    select
      count(*) filter (where status not in ('dismissed')) as total_reports,
      count(*) filter (where status = 'new')              as open_reports,
      count(*) filter (where severity = 'critical')       as critical_reports,
      count(*) filter (where severity = 'high')           as high_reports
    from reports
    where project_id = p_project_id
      and created_at >= v_window_start
  ),
  user_type_split as (
    select
      count(*) filter (where end_user_id is not null) as identified_sessions,
      count(*) filter (where end_user_id is null)     as anonymous_sessions
    from end_user_sessions
    where project_id = p_project_id
      and started_at >= v_window_start
  )
  select into v_result jsonb_build_object(
    'window_days',        p_window_days,
    'sessions',           s.total_sessions,
    'completed_sessions', s.completed_sessions,
    'unique_devices',     s.unique_devices,
    'identified_users',   s.identified_users,
    'avg_page_views',     coalesce(s.avg_page_views, 0),
    'avg_session_minutes',coalesce(s.avg_session_minutes, 0),
    'dau_series',         coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'dau', d.dau) order by d.day) from dau_series d), '[]'::jsonb),
    'top_routes',         coalesce((select jsonb_agg(jsonb_build_object('route', r.route, 'views', r.views) order by r.views desc) from top_routes r), '[]'::jsonb),
    'reports',            jsonb_build_object(
                            'total',    rc.total_reports,
                            'open',     rc.open_reports,
                            'critical', rc.critical_reports,
                            'high',     rc.high_reports
                          ),
    'user_split',         jsonb_build_object(
                            'identified', ut.identified_sessions,
                            'anonymous',  ut.anonymous_sessions
                          )
  )
  from session_stats s, report_counts rc, user_type_split ut;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- org_portfolio_summary(p_org_id)
-- Returns an array of per-project health cards for the Overview page.
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
    select id, name, display_name, slug, created_at
    from projects
    where organization_id = p_org_id
  ),
  per_project as (
    select
      p.id,
      p.name,
      coalesce(p.display_name, p.name) as label,
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

grant execute on function project_activity_summary(uuid, integer) to authenticated;
grant execute on function org_portfolio_summary(uuid) to authenticated;
