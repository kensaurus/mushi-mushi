-- ============================================================================
-- FILE: 20260921000010_funnel_definitions_and_bot_sessions.sql
-- PURPOSE: Bring the measurement layer back to the definitions in
--          docs/plan-gtm.md and keep automation out of every count.
--
--   1. end_user_sessions.is_bot, backfilled from user_agent. Local Playwright
--      runs against production keys made 203 of the-wanting-mind's 212 weekly
--      sessions and 54 of glot.it's; POST /v1/sdk/session now stamps the flag
--      at write time (_shared/automated-agent.ts holds the same pattern).
--   2. project_activity_summary / org_portfolio_summary re-declared to leave
--      bot sessions (and their page views) out. Otherwise verbatim copies of
--      20260714000002 and 20260816130000, grants included (unchanged here).
--   3. merge_end_user_traits(): jsonb || merge for identify() traits. The
--      People tab filters end_users.traits, and nothing wrote it before.
--   4. company_funnel_weekly re-declared. Output keys are unchanged except for
--      one addition (weeks[].activated_opened); the console reads them as-is.
--        - signups: accounts that exist only as Bounties testers
--          (mushi_testers, or user_metadata.signup_track = 'tester') and own
--          no project are not builder signups. A tester who builds counts.
--        - visits / fix_pulled / habit: rows from operator_users (joined via
--          end_users.external_user_id = auth.users.id, and any anon_id ever
--          stitched to an operator) are excluded, like every other column.
--        - keys: the first time a project's key leaves the console. Every
--          project gets an 'sdk-ingest' key at creation (console and CLI), so
--          counting key rows converted Project -> Key at ~100%. Now: the CLI
--          wrote it to .env (wizard_env_written), an SDK authenticated with
--          it (sdk_first_heartbeat), or the user minted a key by hand.
--        - activated_opened (new): the plan's stricter "activated" — the
--          owner opened a real report (console report_opened) within 7 days
--          of signing up. `activated` stays report-derived so the north-star
--          does not read 0 while console events are still being wired.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, CREATE INDEX IF
-- NOT EXISTS; the backfill UPDATE only touches rows not yet flagged.
-- ============================================================================

-- ── 1. end_user_sessions.is_bot ─────────────────────────────────────────────
alter table public.end_user_sessions
  add column if not exists is_bot boolean not null default false;

comment on column public.end_user_sessions.is_bot is
  'User-Agent named a headless browser, test driver or crawler (_shared/automated-agent.ts). Excluded from activity counts.';

-- Same pattern and exception as AUTOMATED_USER_AGENT_PATTERN /
-- HUMAN_USER_AGENT_EXCEPTION_PATTERN in _shared/automated-agent.ts
-- (src/__tests__/automated-agent.test.ts pins the two copies together).
update public.end_user_sessions
   set is_bot = true
 where not is_bot
   and user_agent ~* 'headlesschrome|phantomjs|playwright|puppeteer|selenium|webdriver|lighthouse|crawler|crawling|spider|slurp|facebookexternalhit|embedly|bot([^a-z]|$)'
   and user_agent !~* 'cubot';

-- ── 2. Activity RPCs without bot sessions ───────────────────────────────────
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
                            'identified', ut.identified_sessions,
                            'anonymous',  ut.anonymous_sessions
                          )
  )
  from session_stats s, report_counts rc, user_type_split ut;

  return coalesce(v_result, '{}'::jsonb);
end;
$act$;

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

-- Service role only. Both functions are SECURITY DEFINER and take the
-- project/org id from the caller with no membership check of their own, so the
-- `authenticated` grant in 20260714050000 / 20260816130000 let any signed-in
-- user read another tenant's activity through PostgREST /rpc. Their only
-- caller is api/routes/dashboard.ts, which checks ownership/membership first
-- and then calls them with the service client.
revoke execute on function public.project_activity_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.project_activity_summary(uuid, integer) to service_role;
revoke execute on function public.org_portfolio_summary(uuid) from public, anon, authenticated;
grant execute on function public.org_portfolio_summary(uuid) to service_role;

-- ── 3. merge_end_user_traits ────────────────────────────────────────────────
-- Called by POST /v1/sdk/events with traits the route already sanitized
-- (extractPersonTraits: scalars, no PII-looking keys, <= 1 KB). Skips the
-- write when the row already contains them (the SDK resends traits on every
-- batch) and refuses a merge that would break end_users_traits_size.
create or replace function public.merge_end_user_traits(
  p_end_user_id uuid,
  p_traits jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $trt$
declare
  v_updated integer;
begin
  if p_traits is null or jsonb_typeof(p_traits) <> 'object' or p_traits = '{}'::jsonb then
    return false;
  end if;

  update public.end_users u
     set traits     = u.traits || p_traits,
         updated_at = now()
   where u.id = p_end_user_id
     and not (u.traits @> p_traits)
     and pg_column_size(u.traits || p_traits) <= 2048;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$trt$;

comment on function public.merge_end_user_traits(uuid, jsonb) is
  'identify() traits -> end_users.traits (jsonb ||), no-op when already present or over the 2 KB cap. Service role only (POST /v1/sdk/events).';

revoke all on function public.merge_end_user_traits(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_end_user_traits(uuid, jsonb) to service_role;

-- ── 4. company_funnel_weekly(p_weeks, p_source) ─────────────────────────────
create or replace function public.company_funnel_weekly(
  p_weeks integer default 8,
  p_source text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_weeks       integer     := greatest(1, least(coalesce(p_weeks, 8), 52));
  v_source      text        := nullif(nullif(trim(coalesce(p_source, '')), ''), 'all');
  v_self        uuid;
  v_end         timestamptz := date_trunc('week', now()) + interval '1 week';
  v_start       timestamptz;
  v_habit_start timestamptz;
begin
  v_start := v_end - (v_weeks * interval '1 week');
  -- habit looks back 3 extra weeks so the oldest reported week has a full
  -- trailing-4-week window.
  v_habit_start := v_start - interval '3 weeks';

  select nullif(value, '')::uuid
    into v_self
    from public.mushi_runtime_config
   where key = 'self_project_id';

  return (
    with wk as (
      select gs as week_start, gs + interval '1 week' as week_end
      from generate_series(v_start, v_end - interval '1 week', interval '1 week') as gs
    ),
    op as (
      select user_id from public.operator_users
    ),
    -- Operators as the self project's end users: resolveSelfEndUser keys
    -- end_users.external_user_id on auth.users.id.
    op_people as (
      select eu.id as end_user_id
      from public.end_users eu
      join op on eu.external_user_id = op.user_id::text
    ),
    -- Browsers an operator has ever been identified in. identify() backfills
    -- earlier anonymous rows, but rows sent after a sign-out stay anonymous.
    op_anon as (
      select distinct e.anon_id
      from public.product_events e
      join op_people o on o.end_user_id = e.end_user_id
      where v_self is not null
        and e.project_id = v_self
        and e.anon_id is not null
    ),
    -- Non-operator console users with their acquisition source. No time
    -- filter here: projects join back to this set by owner regardless of
    -- when the owner signed up. Tester-only accounts are not builder signups.
    people as (
      select u.id,
             u.created_at,
             coalesce(u.raw_user_meta_data ->> 'signup_source', 'unknown') as source
      from auth.users u
      where not exists (select 1 from op where op.user_id = u.id)
        and (v_source is null or u.raw_user_meta_data ->> 'signup_source' = v_source)
        and not (
          (   exists (select 1 from public.mushi_testers t where t.auth_user_id = u.id)
           or coalesce(u.raw_user_meta_data ->> 'signup_track', '') = 'tester')
          and not exists (select 1 from public.projects owned where owned.owner_id = u.id)
        )
    ),
    -- Projects owned by a non-operator whose organization owner is also not
    -- an operator (legacy ownerless-org projects pass through the left join).
    proj as (
      select p.id, p.created_at, p.owner_id, ppl.source, ppl.created_at as owner_signed_up_at
      from public.projects p
      join people ppl on ppl.id = p.owner_id
      left join public.organizations o on o.id = p.organization_id
      where not exists (select 1 from op where op.user_id = o.owner_id)
    ),
    -- Key = the first time a project's key leaves the console. The
    -- 'sdk-ingest' key minted with every new project (projects-crud.ts,
    -- cli-auth.ts) does not count on its own; it counts once the CLI writes
    -- it to .env or an SDK authenticates with it.
    key_signals as (
      select f.project_id, f.created_at as at
      from public.setup_funnel_events f
      join proj on proj.id = f.project_id
      where f.event_name in ('wizard_env_written', 'sdk_first_heartbeat')
      union all
      select k.project_id, k.created_at as at
      from public.project_api_keys k
      join proj on proj.id = k.project_id
      where not (k.label = 'sdk-ingest' and k.created_at < proj.created_at + interval '5 minutes')
    ),
    first_keys as (
      select ks.project_id, min(ks.at) as first_at
      from key_signals ks
      group by ks.project_id
    ),
    -- "Activated" = the project's first real report. Console test reports
    -- and the marketing demo seed never count.
    first_reports as (
      select r.project_id, min(r.created_at) as first_at
      from public.reports r
      join proj on proj.id = r.project_id
      where coalesce(r.custom_metadata ->> 'source', '')
              not in ('mushi-marketing-seed', 'admin_test_report')
      group by r.project_id
    ),
    -- Mushi's own product_events (landing, console, MCP) under the self
    -- project, without operators.
    self_events as (
      select e.event_name,
             e.ts,
             e.anon_id,
             e.end_user_id,
             e.properties,
             coalesce(e.end_user_id::text, e.anon_id) as person
      from public.product_events e
      where v_self is not null
        and e.project_id = v_self
        and e.ts >= v_habit_start
        and e.ts <  v_end
        and e.event_name in ('landing_view', 'fix_context_pulled', 'report_opened')
        and (e.end_user_id is null
             or not exists (select 1 from op_people o where o.end_user_id = e.end_user_id))
        and (e.anon_id is null
             or not exists (select 1 from op_anon a where a.anon_id = e.anon_id))
    ),
    -- docs/plan-gtm.md "activated": the owner opened a real report of the
    -- project within 7 days of signing up. Counted in the week of that open.
    -- self_events reaches back 3 weeks before the window, far enough to see
    -- every open that could still fall inside a 7-day signup window.
    first_opens as (
      select r.project_id, min(se.ts) as opened_at
      from self_events se
      join public.end_users eu on eu.id = se.end_user_id
      join public.reports r on r.id::text = se.properties ->> 'report_id'
      join proj on proj.id = r.project_id
      where se.event_name = 'report_opened'
        and eu.external_user_id = proj.owner_id::text
        and se.ts < proj.owner_signed_up_at + interval '7 days'
        and coalesce(r.custom_metadata ->> 'source', '')
              not in ('mushi-marketing-seed', 'admin_test_report')
      group by r.project_id
    ),
    -- One row per (identified person, week) with any diagnosis engagement.
    habit_weeks as (
      select distinct se.end_user_id, date_trunc('week', se.ts) as week_start
      from self_events se
      where se.end_user_id is not null
        and se.event_name in ('report_opened', 'fix_context_pulled')
    ),
    weekly as (
      select
        wk.week_start,
        (select count(distinct se.anon_id)
           from self_events se
          where se.event_name = 'landing_view'
            and se.anon_id is not null
            and se.ts >= wk.week_start and se.ts < wk.week_end)                     as visits,
        (select count(*)
           from people ppl
          where ppl.created_at >= wk.week_start and ppl.created_at < wk.week_end)  as signups,
        (select count(*)
           from proj
          where proj.created_at >= wk.week_start and proj.created_at < wk.week_end) as projects,
        (select count(*)
           from first_keys fk
          where fk.first_at >= wk.week_start and fk.first_at < wk.week_end)        as keys,
        (select count(distinct f.project_id)
           from public.setup_funnel_events f
           join proj on proj.id = f.project_id
          where f.event_name = 'sdk_first_heartbeat'
            and f.created_at >= wk.week_start and f.created_at < wk.week_end)      as sdk_installed,
        (select count(*)
           from first_reports fr
          where fr.first_at >= wk.week_start and fr.first_at < wk.week_end)        as activated,
        (select count(*)
           from first_opens fo
          where fo.opened_at >= wk.week_start and fo.opened_at < wk.week_end)      as activated_opened,
        (select count(distinct se.person)
           from self_events se
          where se.event_name = 'fix_context_pulled'
            and se.person is not null
            and se.ts >= wk.week_start and se.ts < wk.week_end)                     as fix_pulled,
        -- Habit: engaged in >= 3 of the trailing 4 weeks ending this week.
        (select count(*)
           from (
             select hw.end_user_id
               from habit_weeks hw
              where hw.week_start >  wk.week_start - interval '4 weeks'
                and hw.week_start <= wk.week_start
              group by hw.end_user_id
             having count(*) >= 3
           ) h)                                                                     as habit,
        (select count(*)
           from public.billing_subscriptions bs
           join proj on proj.id = bs.project_id
          where bs.status = 'active'
            and bs.plan_id <> 'free_cloud'
            and bs.created_at >= wk.week_start and bs.created_at < wk.week_end)    as paid
      from wk
    ),
    window_activations as (
      select fr.project_id, fr.first_at, proj.source
      from first_reports fr
      join proj on proj.id = fr.project_id
      where fr.first_at >= v_start and fr.first_at < v_end
    ),
    window_signups as (
      select ppl.id, ppl.source
      from people ppl
      where ppl.created_at >= v_start and ppl.created_at < v_end
    ),
    by_source as (
      select s.source,
             (select count(*) from window_signups ws where ws.source = s.source)      as signups,
             (select count(*) from window_activations wa where wa.source = s.source)  as activated
      from (
        select source from window_signups
        union
        select source from window_activations
      ) s
    )
    select jsonb_build_object(
      'weeks', coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'week_start',       to_char(w.week_start, 'YYYY-MM-DD'),
                    'visits',           w.visits,
                    'signups',          w.signups,
                    'projects',         w.projects,
                    'keys',             w.keys,
                    'sdk_installed',    w.sdk_installed,
                    'activated',        w.activated,
                    'activated_opened', w.activated_opened,
                    'fix_pulled',       w.fix_pulled,
                    'habit',            w.habit,
                    'paid',             w.paid
                  )
                  order by w.week_start desc
                )
           from weekly w),
        '[]'::jsonb),
      'by_source', coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'source',    b.source,
                    'signups',   b.signups,
                    'activated', b.activated
                  )
                  order by b.signups desc, b.source
                )
           from by_source b),
        '[]'::jsonb),
      'window_start',            to_char(v_start, 'YYYY-MM-DD'),
      'window_end',              to_char(v_end, 'YYYY-MM-DD'),
      'source',                  coalesce(v_source, 'all'),
      'self_project_configured', (v_self is not null)
    )
  );
end;
$fn$;

comment on function public.company_funnel_weekly(integer, text) is
  'Mushi company funnel per ISO week (newest first) + signups/activated by signup_source. Excludes operator_users everywhere and tester-only accounts from signups; keys = first key leaving the console; activated_opened = owner opened a real report within 7 days of signup. Service role only — GET /v1/admin/growth/funnel behind requireOperator.';

-- Unchanged from 20260921000002: service role only.
revoke all on function public.company_funnel_weekly(integer, text) from public, anon, authenticated;
grant execute on function public.company_funnel_weekly(integer, text) to service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
