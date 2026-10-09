-- ============================================================================
-- FILE: 20261004163000_console_counts_one_definition.sql
-- PURPOSE: One definition for the counts the console dashboard family shows
--          (console repair, group H, 2026-10-04). Additive / CREATE OR REPLACE
--          only; every function keeps its signature and stays service-role
--          only (the edge layer checks membership before calling it).
--
--   1. integration_health_rollup(p_project_ids, p_since)          NEW
--      Latest status per (project, kind) plus ok / total probe counts in the
--      window. Replaces three JS reads of integration_health_history that
--      disagreed: /v1/admin/dashboard read the OLDEST 2000 rows (stale
--      "latest" status), dashboard/stats the newest 500 across projects,
--      inbox/stats ignored `down`. Read by _shared/integration-health-rollup.ts.
--
--   2. project_activity_summary(p_project_id, p_window_days)      REPLACED
--      reports.open / critical / high now count OPEN reports of any age with
--      the console's open-status list (api/shared.ts OPEN_REPORT_STATUSES), so
--      each pill equals the /reports?status=open list it links to. `open` was
--      status = 'new' only; critical / high counted fixed and dismissed reports.
--      user_split gains identified_people / anonymous_devices: the existing
--      identified / anonymous keys count SESSIONS, which the page read as users.
--
--   3. org_portfolio_summary(p_org_id)                            REPLACED
--      open_reports / critical_reports use the same open-status list instead
--      of ('new','classified','fixing'), which hid queued, triaged, grouped
--      and reopened reports from the Overview cards.
--
--   4. product_events_summary(p_project_id, p_window_days)        REPLACED
--      Adds distinct_events (count of event names) and event_names (every
--      name, most used first, up to 500). top_events stays the top 20 list;
--      the "Distinct events" stat and the event pickers read it as the whole
--      catalogue and capped at 20.
--
--   5. llm_spend_before(p_project_id, p_before)                     NEW
--      All-time LLM spend older than the Costs page's 30-day window, summed
--      in SQL: persisted invocation cost, legacy ledger cost, and the number
--      of invocation rows with no persisted cost (the API prices those with
--      resolveCostUsd, the budget's rule). Replaces a JS read of every older
--      row that PostgREST capped at 1,000.
--
-- The open-status list below must equal OPEN_REPORT_STATUSES; the vitest
-- `console-counts-migration.test.ts` asserts it.
-- ============================================================================

-- ── 1. integration_health_rollup ────────────────────────────────────────────
create or replace function public.integration_health_rollup(
  p_project_ids uuid[],
  p_since timestamptz
)
returns table (
  project_id uuid,
  kind text,
  last_status text,
  last_at timestamptz,
  ok_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $ihr$
  with scoped as (
    select h.project_id, h.kind, h.status, h.checked_at
      from public.integration_health_history h
     where h.project_id = any(p_project_ids)
       and h.checked_at >= p_since
  ),
  latest as (
    select distinct on (s.project_id, s.kind)
           s.project_id, s.kind, s.status, s.checked_at
      from scoped s
     order by s.project_id, s.kind, s.checked_at desc
  ),
  agg as (
    select s.project_id, s.kind,
           (count(*) filter (where s.status = 'ok'))::bigint as ok_count,
           count(*)::bigint                                   as total_count
      from scoped s
     group by s.project_id, s.kind
  )
  select l.project_id, l.kind, l.status, l.checked_at, a.ok_count, a.total_count
    from latest l
    join agg a on a.project_id = l.project_id and a.kind = l.kind;
$ihr$;

comment on function public.integration_health_rollup(uuid[], timestamptz) is
  'Latest integration health status per (project, kind) since p_since, with ok/total probe counts. Service role only (api/routes/dashboard.ts).';

revoke all on function public.integration_health_rollup(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.integration_health_rollup(uuid[], timestamptz) to service_role;

-- ── 2. project_activity_summary ─────────────────────────────────────────────
create or replace function public.project_activity_summary(
  p_project_id uuid,
  p_window_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $act$
declare
  v_window_start timestamptz := now() - (p_window_days || ' days')::interval;
  v_open_statuses constant text[] := array['new','queued','pending','submitted','classified','triaged','grouped','reopened'];
  v_result jsonb;
begin
  with
  human_sessions as (
    select *
    from end_user_sessions
    where project_id = p_project_id
      and started_at >= v_window_start
      and not is_bot
  ),
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
    from human_sessions
  ),
  dau_series as (
    select
      date_trunc('day', started_at) as day,
      count(distinct reporter_token_hash) as dau
    from human_sessions
    group by 1
    order by 1
  ),
  top_routes as (
    select
      pv.route,
      count(*) as views
    from session_page_views pv
    where pv.project_id = p_project_id
      and pv.ts >= v_window_start
      and pv.route is not null
      -- Page views written before is_bot existed: drop those of bot sessions.
      and not exists (
        select 1
        from end_user_sessions s
        where s.project_id = pv.project_id
          and s.session_id = pv.session_id
          and s.is_bot
      )
    group by pv.route
    order by views desc
    limit 10
  ),
  report_counts as (
    -- total: reports received in the window. open / critical / high: reports
    -- still open now, any age — the set /reports?status=open lists.
    select
      (select count(*) from reports
        where project_id = p_project_id
          and created_at >= v_window_start
          and status not in ('dismissed'))                       as total_reports,
      count(*)                                                    as open_reports,
      count(*) filter (where severity = 'critical')              as critical_reports,
      count(*) filter (where severity = 'high')                  as high_reports
    from reports
    where project_id = p_project_id
      and status = any(v_open_statuses)
  ),
  user_type_split as (
    select
      count(*) filter (where end_user_id is not null) as identified_sessions,
      count(*) filter (where end_user_id is null)     as anonymous_sessions,
      count(distinct end_user_id) filter (where end_user_id is not null) as identified_people,
      count(distinct reporter_token_hash) filter (where end_user_id is null) as anonymous_devices
    from human_sessions
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
                            'identified',        ut.identified_sessions,
                            'anonymous',         ut.anonymous_sessions,
                            'identified_people', ut.identified_people,
                            'anonymous_devices', ut.anonymous_devices
                          )
  )
  from session_stats s, report_counts rc, user_type_split ut;

  return coalesce(v_result, '{}'::jsonb);
end;
$act$;

-- ── 3. org_portfolio_summary ────────────────────────────────────────────────
create or replace function public.org_portfolio_summary(
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $port$
declare
  v_window_start timestamptz := now() - interval '7 days';
  v_open_statuses constant text[] := array['new','queued','pending','submitted','classified','triaged','grouped','reopened'];
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
        where s.project_id = p.id and s.started_at >= v_window_start and not s.is_bot
      ), 0) as sessions_7d,
      coalesce((
        select count(distinct reporter_token_hash)
        from end_user_sessions s
        where s.project_id = p.id and s.started_at >= v_window_start and not s.is_bot
      ), 0) as users_7d,
      coalesce((
        select count(*)
        from reports r
        where r.project_id = p.id and r.status = any(v_open_statuses)
      ), 0) as open_reports,
      coalesce((
        select count(*)
        from reports r
        where r.project_id = p.id
          and r.status = any(v_open_statuses)
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
          where project_id = p.id and started_at >= v_window_start and not is_bot
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
$port$;

revoke execute on function public.project_activity_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.project_activity_summary(uuid, integer) to service_role;
revoke execute on function public.org_portfolio_summary(uuid) from public, anon, authenticated;
grant execute on function public.org_portfolio_summary(uuid) to service_role;

-- ── 4. product_events_summary ───────────────────────────────────────────────
create or replace function public.product_events_summary(
  p_project_id uuid,
  p_window_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_days   integer     := greatest(1, least(coalesce(p_window_days, 30), 365));
  v_from   timestamptz;
  v_result jsonb;
begin
  v_from := date_trunc('day', now()) - ((v_days - 1) * interval '1 day');

  with ev as (
    select event_name, ts, end_user_id,
           coalesce(end_user_id::text, anon_id) as person
      from public.product_events
     where project_id = p_project_id
       and ts >= v_from
  ),
  totals as (
    select count(*)::bigint                                                    as events_total,
           count(distinct person)::bigint                                      as persons,
           (count(distinct person) filter (where end_user_id is not null))::bigint as identified,
           (count(distinct person) filter (where end_user_id is null))::bigint     as anonymous,
           count(distinct event_name)::bigint                                  as distinct_events
      from ev
  ),
  days as (
    select gs::date as day
      from generate_series(v_from, date_trunc('day', now()), interval '1 day') as gs
  ),
  per_day as (
    select d.day, coalesce(c.cnt, 0)::bigint as cnt
      from days d
      left join (
        select ts::date as day, count(*) as cnt
          from ev
         group by 1
      ) c on c.day = d.day
  ),
  by_name as (
    select event_name,
           count(*)::bigint               as cnt,
           count(distinct person)::bigint as persons
      from ev
     group by event_name
  ),
  top as (
    select * from by_name order by cnt desc, event_name limit 20
  ),
  names as (
    select event_name, cnt from by_name order by cnt desc, event_name limit 500
  )
  select jsonb_build_object(
           'window_days',     v_days,
           'events_total',    t.events_total,
           'persons',         t.persons,
           'identified',      t.identified,
           'anonymous',       t.anonymous,
           'distinct_events', t.distinct_events,
           'events_per_day',  (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'count', cnt) order by day), '[]'::jsonb) from per_day),
           'top_events',      (select coalesce(jsonb_agg(jsonb_build_object('name', event_name, 'count', cnt, 'persons', persons) order by cnt desc, event_name), '[]'::jsonb) from top),
           'event_names',     (select coalesce(jsonb_agg(event_name order by cnt desc, event_name), '[]'::jsonb) from names)
         )
    into v_result
    from totals t;

  return v_result;
end;
$fn$;

comment on function public.product_events_summary(uuid, integer) is
  'Users & Funnels overview for one project over the last N days: totals, identified vs anonymous persons, distinct event count, events per day, top 20 events, every event name (up to 500). Service role only (GET /v1/admin/events/summary).';

revoke all on function public.product_events_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.product_events_summary(uuid, integer) to service_role;

-- ── 5. llm_spend_before ─────────────────────────────────────────────────────
create or replace function public.llm_spend_before(
  p_project_id uuid,
  p_before timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $lsb$
  select jsonb_build_object(
    'persisted_usd', coalesce((
      select sum(i.cost_usd) from public.llm_invocations i
       where i.project_id = p_project_id and i.created_at < p_before and i.cost_usd is not null
    ), 0),
    'unpriced_rows', (
      select count(*) from public.llm_invocations i
       where i.project_id = p_project_id and i.created_at < p_before and i.cost_usd is null
    ),
    'ledger_usd', coalesce((
      select sum(l.cost_usd) from public.llm_cost_usd l
       where l.project_id = p_project_id and l.occurred_at < p_before
    ), 0)
  );
$lsb$;

comment on function public.llm_spend_before(uuid, timestamptz) is
  'LLM spend recorded before p_before for one project: persisted invocation cost, legacy ledger cost, and the count of invocation rows with no persisted cost. Service role only (GET /v1/admin/costs/stats).';

revoke all on function public.llm_spend_before(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.llm_spend_before(uuid, timestamptz) to service_role;
