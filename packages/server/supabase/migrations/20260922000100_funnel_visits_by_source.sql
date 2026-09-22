-- ============================================================================
-- 20260922000100_funnel_visits_by_source
--
-- company_funnel_weekly, re-declared from 20260922000001's body (identical to
-- prod prosrc apart from comment lines) with the changes below. Every
-- existing output key, the activated definitions and the service_role-only
-- grant are unchanged; three weekly keys are added.
--
-- 1. visits counts landing_view AND docs_page_view.
--    The docs site tracked only '/', '/quickstart*' and '/pricing', and visits
--    counted landing_view alone, so a visitor who entered on any other docs
--    page was never a visit. The site now emits docs_page_view on every route
--    (apps/docs/lib/site-analytics.ts viewEventsForRoute); visits is distinct
--    anon ids across both names. self_events loads docs_page_view for it.
--
-- 2. Source falls back to the first touch.
--    All six external signups had no signup_source (the "How did you hear
--    about us?" answer is optional), so by_source was one 'unknown' row. The
--    console now stores the first-touch utm_source as
--    raw_user_meta_data ->> 'signup_first_touch' (the docs site forwards it as
--    ?ft_src=, apps/admin/src/lib/signupAttribution.ts). people.source is
--    signup_source, else signup_first_touch, else 'unknown' (NULL, '' and a
--    literal 'unknown' all fall through), and p_source filters on that same
--    value, so every by_source row is also a working filter.
--
-- 3. Loop columns for K-factor: loop_impressions, loop_clicks, loop_signups.
--    loop_impression / loop_click are emitted by the widget into the HOST
--    customer's project, so they are read across all projects' product_events
--    (the self project excluded — see the loop_events comment).
--    loop_signups counts people (so operators and tester-only accounts stay
--    out, and p_source applies) whose loop_ref has the widget mark's shape,
--    '^[0-9a-f]{6,64}$'. Until 2026-09-22 the docs site wrote the first-touch
--    utm_source into ?ref=, so older accounts can carry loop_ref = 'hn' etc.;
--    the pattern keeps those out.
--
-- 4. product_events_loop_ts: a partial index for the cross-project loop read.
--    Every other product_events index leads with project_id; without this the
--    loop columns would scan every customer's events. Only loop rows are
--    indexed. The table is empty in prod at the time of writing, so the build
--    is instant.
-- ============================================================================

create index if not exists product_events_loop_ts
  on public.product_events (ts)
  where event_name in ('loop_impression', 'loop_click');

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
    -- Source = the self-reported signup_source, else the first-touch
    -- utm_source the console stored as signup_first_touch, else 'unknown';
    -- p_source filters on that same value. loop_referred = the signup URL
    -- carried a widget loop ref (6-64 lowercase hex, the shape
    -- apps/admin/src/lib/signupAttribution.ts isLoopRef accepts).
    people as (
      select u.id,
             u.created_at,
             src.source,
             coalesce(u.raw_user_meta_data ->> 'loop_ref', '') ~ '^[0-9a-f]{6,64}$' as loop_referred
      from auth.users u
      cross join lateral (
        select coalesce(
                 nullif(nullif(u.raw_user_meta_data ->> 'signup_source', ''), 'unknown'),
                 nullif(u.raw_user_meta_data ->> 'signup_first_touch', ''),
                 'unknown') as source
      ) src
      where not exists (select 1 from op where op.user_id = u.id)
        and (v_source is null or src.source = v_source)
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
        and e.event_name in ('landing_view', 'docs_page_view', 'fix_context_pulled', 'report_opened', 'fix_dispatched')
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
        and se.event_name in ('report_opened', 'fix_context_pulled', 'fix_dispatched')
    ),
    -- Growth-loop exposure. The widget's "Bug reports by Mushi" mark emits
    -- loop_impression / loop_click into the HOST customer's project, so this
    -- reads every project's product_events, not just the self project's.
    -- The self project is left out: a mark on Mushi's own surfaces reaches
    -- people who already use Mushi. Not source-filterable (like visits).
    loop_events as (
      select e.event_name, e.ts
      from public.product_events e
      where e.event_name in ('loop_impression', 'loop_click')
        and e.ts >= v_start
        and e.ts <  v_end
        and (v_self is null or e.project_id <> v_self)
    ),
    weekly as (
      select
        wk.week_start,
        (select count(distinct se.anon_id)
           from self_events se
          where se.event_name in ('landing_view', 'docs_page_view')
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
            and bs.created_at >= wk.week_start and bs.created_at < wk.week_end)    as paid,
        (select count(*)
           from loop_events le
          where le.event_name = 'loop_impression'
            and le.ts >= wk.week_start and le.ts < wk.week_end)                     as loop_impressions,
        (select count(*)
           from loop_events le
          where le.event_name = 'loop_click'
            and le.ts >= wk.week_start and le.ts < wk.week_end)                     as loop_clicks,
        -- Signups that arrived through a widget mark. Read from the user row
        -- (loop_ref), not the console's loop_signup event, so a signup whose
        -- browser never sent analytics still counts.
        (select count(*)
           from people ppl
          where ppl.loop_referred
            and ppl.created_at >= wk.week_start and ppl.created_at < wk.week_end)  as loop_signups
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
                    'paid',             w.paid,
                    'loop_impressions', w.loop_impressions,
                    'loop_clicks',      w.loop_clicks,
                    'loop_signups',     w.loop_signups
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
  'Mushi company funnel per ISO week (newest first) + signups/activated by source (signup_source, else the first-touch utm_source stored as signup_first_touch). Excludes operator_users everywhere and tester-only accounts from signups; visits = distinct anon ids with landing_view or docs_page_view; keys = first key leaving the console; activated = first real report; activated_opened = owner opened a real report within 7 days of signup; habit = report_opened, fix_context_pulled or fix_dispatched (console or MCP) in 3 of 4 weeks; loop_impressions / loop_clicks = widget-mark events across all projects except the self project; loop_signups = signups whose loop_ref is a widget loop ref. Service role only — GET /v1/admin/growth/funnel behind requireOperator.';

-- Unchanged: service role only.
revoke all on function public.company_funnel_weekly(integer, text) from public, anon, authenticated;
grant execute on function public.company_funnel_weekly(integer, text) to service_role;

notify pgrst, 'reload schema';
