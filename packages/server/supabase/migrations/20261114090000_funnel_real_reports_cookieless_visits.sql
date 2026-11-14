-- ============================================================================
-- 20261114090000_funnel_real_reports_cookieless_visits
--
-- Two honesty fixes to the company funnel (growth audit 2026-11-14).
--
-- 1. "Activated" counted tool and test reports.
--    company_funnel_weekly's first_reports left out only the console test
--    report and the demo seed. On prod (checked 2026-11-14) both activations
--    it ever counted were not people using an app: week 2026-10-26 was a
--    widget report from http://localhost:5299 (a dev-server test) and week
--    2026-11-09 was the mushi init test report from cli://wizard, sent by a
--    CLI older than 0.36 with no custom_metadata.source. The same wizard
--    report also got first_real_report and activated product_events on
--    2026-11-10, before ingest learned the cli:// rule.
--
--    is_activation_candidate_report(source, custom_metadata, url) is the SQL
--    twin of isActivationCandidate (_shared/activation.ts), the rule ingest
--    and classify-report already use: reports.source is widget or sdk, the
--    custom_metadata.source is not a fixture or hand-filed report
--    (NOT_FIRST_REPORT_SOURCES, _shared/first-report.ts), and the page URL is
--    neither a cli:// tool URL nor a local dev URL (LOCAL_DEV_URL_PATTERN,
--    _shared/report-origin.ts). A native report with no URL counts.
--    funnel-real-report-parity.test.ts compares the lists and the pattern.
--
--    company_funnel_weekly uses it in first_reports (activated, by_source)
--    and first_opens (activated_opened), and drops a first_real_report path
--    event whose report fails it. gtm_daily_scorecard drops an activated
--    event whose report fails it. No row is deleted or changed: the two
--    stale product_events stay and are only left out of the counts.
--
-- 2. visits now reads the cookieless counter.
--    visits counted distinct anon ids that sent landing_view or
--    docs_page_view, which the docs site sends only after the consent bar
--    is accepted: 0 or 1 a week. landing_page_views_daily (20261028210000)
--    counts every page view with nothing personal kept. visits is now that
--    count per ISO week, without referrer spam (is_spam_referrer_host, the
--    maintained denylist from 20261111090000 that mirrors
--    SPAM_REFERRER_HOSTS in _shared/landing-visits.ts; add a host to both
--    and the parity test in landing-visits.test.ts). Its unit changes from
--    people to page views; the earlier measure stays as visits_consented,
--    and visits_spam_excluded reports what the denylist left out. With
--    p_source set, visits counts only views whose ?src= tag equals it.
--
-- Both function bodies are the previous repo definitions (20261029120000,
-- 20261111090000), which match prod prosrc apart from comments and
-- whitespace (checked 2026-11-14), plus the changes above. Every existing
-- output key stays; three are added. Service role only.
--
-- Not applied by this commit: the lead applies it with a ledger row in the
-- same transaction (never MCP apply_migration).
--
-- Verify after applying (expected values from prod on 2026-11-14):
--   select has_function_privilege('anon', 'public.is_activation_candidate_report(text, jsonb, text)', 'execute');  -- f
--   select public.is_activation_candidate_report('widget', '{}'::jsonb, 'cli://wizard');            -- f
--   select public.is_activation_candidate_report('widget', '{}'::jsonb, 'http://localhost:5299/');  -- f
--   select public.is_activation_candidate_report('widget', '{}'::jsonb, 'https://example.com/a');   -- t
--   select public.is_activation_candidate_report(null, null, null);                                 -- t
--   select w ->> 'week_start', w ->> 'visits', w ->> 'visits_spam_excluded', w ->> 'visits_consented',
--          w ->> 'activated', w ->> 'first_real_report'
--     from jsonb_array_elements(public.company_funnel_weekly(4, null) -> 'weeks') w;
--   -- 2026-11-09: visits 74, activated 0, first_real_report 0
--   -- 2026-11-02: visits 40, visits_spam_excluded 216
--   -- 2026-10-26: visits 25, visits_spam_excluded 4, activated 0
--   select sum((d ->> 'activated')::int) from jsonb_array_elements(public.gtm_daily_scorecard(30) -> 'days') d;  -- 0
-- ============================================================================

-- ── 1. is_activation_candidate_report() ─────────────────────────────────────
create or replace function public.is_activation_candidate_report(
  p_source          text,
  p_custom_metadata jsonb,
  p_url             text
)
returns boolean
language sql
immutable
set search_path = public
as $act$
  select coalesce(p_source, 'widget') in ('widget', 'sdk')
     and coalesce(p_custom_metadata ->> 'source', '') not in (
           'admin_test_report', 'mushi-marketing-seed', 'admin_file', 'cli_wizard')
     and coalesce(p_url, '') !~* '^cli://'
     and coalesce(p_url, '') !~* '^[a-z][a-z0-9+.-]*://((localhost|127\.[0-9.]+|0\.0\.0\.0|\[::1\]):[0-9]+|(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9.]+(:[0-9]+)?|[a-z0-9.-]+\.(localhost|local|test)(:[0-9]+)?)([/?#]|$)';
$act$;

comment on function public.is_activation_candidate_report(text, jsonb, text) is
  'True when a report is a real end-user report from a deployed app: SQL twin of isActivationCandidate in functions/_shared/activation.ts (end-user source, not a NOT_FIRST_REPORT_SOURCES fixture, not a cli:// tool URL, not a LOCAL_DEV_URL_PATTERN dev URL). funnel-real-report-parity.test.ts compares the two. Service role only.';

revoke all on function public.is_activation_candidate_report(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.is_activation_candidate_report(text, jsonb, text) to service_role;

-- ── 2. company_funnel_weekly(), re-declared ─────────────────────────────────
-- Unchanged from 20260922000100 (idempotent, already on prod): the partial
-- index the loop columns read, kept next to the definition that uses it.
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
    -- Synthetic fresh-eyes accounts (ADR 0053) are operator_users already;
    -- they are named here as well so a missed operator row cannot count one.
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
        and not exists (select 1 from public.synthetic_accounts sa where sa.user_id = u.id)
        and (v_source is null or src.source = v_source)
        and not (
          (   exists (select 1 from public.mushi_testers t where t.auth_user_id = u.id)
           or coalesce(u.raw_user_meta_data ->> 'signup_track', '') = 'tester')
          and not exists (select 1 from public.projects owned where owned.owner_id = u.id)
        )
    ),
    -- Projects owned by a non-operator whose organization owner is also not
    -- an operator (legacy ownerless-org projects pass through the left join),
    -- outside complimentary organizations (the owner's own apps, which /proof's
    -- public_scoreboard() reports on its own).
    proj as (
      select p.id, p.created_at, p.owner_id, ppl.source, ppl.created_at as owner_signed_up_at
      from public.projects p
      join people ppl on ppl.id = p.owner_id
      left join public.organizations o on o.id = p.organization_id
      where not exists (select 1 from op where op.user_id = o.owner_id)
        and coalesce(o.billing_mode, '') <> 'complimentary'
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
    -- "Activated" = the project's first real end-user report: the rule
    -- _shared/activation.ts isActivationCandidate applies at ingest, through
    -- is_activation_candidate_report(). The wizard's cli://wizard test, a
    -- localhost dev-server test, console test reports, the demo seed,
    -- hand-filed reports and every report Mushi files itself never count.
    first_reports as (
      select r.project_id, min(r.created_at) as first_at
      from public.reports r
      join proj on proj.id = r.project_id
      where public.is_activation_candidate_report(r.source, r.custom_metadata, r.environment ->> 'url')
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
        and public.is_activation_candidate_report(r.source, r.custom_metadata, r.environment ->> 'url')
      group by r.project_id
    ),
    -- One row per (identified person, week) with any diagnosis engagement.
    habit_weeks as (
      select distinct se.end_user_id, date_trunc('week', se.ts) as week_start
      from self_events se
      where se.end_user_id is not null
        and se.event_name in ('report_opened', 'fix_context_pulled', 'fix_dispatched')
    ),
    -- The new-user path (plan-simplicity Phase 0): server product_events,
    -- one per host project ever (dedup key '<step>:<project id>'), kept to
    -- outside projects by the join on proj.
    path_events as (
      select e.event_name, e.ts, proj.id as project_id
      from public.product_events e
      join proj on proj.id::text = e.properties ->> 'project_id'
      where v_self is not null
        and e.project_id = v_self
        and e.ts >= v_start
        and e.ts <  v_end
        and e.event_name in ('sdk_seen_localhost', 'sdk_seen_live', 'first_real_report',
                             'first_diagnosis_viewed', 'first_fix_dispatched', 'first_fix_merged')
        -- A first_real_report event emitted before ingest knew the rule (the
        -- cli://wizard test on 2026-11-10, before TOOL_URL_RE) is left out
        -- when its report fails the rule. Only first_real_report carries
        -- report_id; the other steps pass through. An event whose report is
        -- gone still counts (the row is kept, not judged).
        and (e.event_name <> 'first_real_report'
             or not exists (
               select 1
               from public.reports r
               where r.id::text = e.properties ->> 'report_id'
                 and not public.is_activation_candidate_report(r.source, r.custom_metadata, r.environment ->> 'url')))
    ),
    -- Cookieless page views (landing_page_views_daily, 20261028210000): one
    -- row per UTC day, path, ?src= tag and referrer host, recorded without
    -- consent and without anything personal. Referrer spam
    -- (is_spam_referrer_host, 20261111090000) is left out; spam rows stay in
    -- the table. With p_source set, only views whose ?src= tag equals it
    -- count (the tag is the same lowercase value signup_first_touch stores).
    page_views as (
      select v.day,
             sum(v.views) filter (where not public.is_spam_referrer_host(v.referrer_host))::bigint as n,
             sum(v.views) filter (where public.is_spam_referrer_host(v.referrer_host))::bigint     as spam
      from public.landing_page_views_daily v
      where v.day >= (v_start at time zone 'utc')::date
        and v.day <  (v_end at time zone 'utc')::date
        and (v_source is null or v.src = v_source)
      group by v.day
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
        -- visits = cookieless page views without referrer spam. Page views,
        -- not people: the counter keeps no visitor id. Before 2026-10-28 the
        -- table is empty, so older weeks read 0 here; visits_consented keeps
        -- the earlier measure.
        (select coalesce(sum(pv.n), 0)
           from page_views pv
          where pv.day >= (wk.week_start at time zone 'utc')::date
            and pv.day <  (wk.week_end at time zone 'utc')::date)                  as visits,
        (select coalesce(sum(pv.spam), 0)
           from page_views pv
          where pv.day >= (wk.week_start at time zone 'utc')::date
            and pv.day <  (wk.week_end at time zone 'utc')::date)                  as visits_spam_excluded,
        -- The previous visits measure: distinct anon ids that accepted the
        -- consent bar and sent landing_view or docs_page_view.
        (select count(distinct se.anon_id)
           from self_events se
          where se.event_name in ('landing_view', 'docs_page_view')
            and se.anon_id is not null
            and se.ts >= wk.week_start and se.ts < wk.week_end)                     as visits_consented,
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
            and ppl.created_at >= wk.week_start and ppl.created_at < wk.week_end)  as loop_signups,
        (select count(distinct pe.project_id)
           from path_events pe
          where pe.event_name = 'sdk_seen_localhost'
            and pe.ts >= wk.week_start and pe.ts < wk.week_end)                     as sdk_seen_localhost,
        (select count(distinct pe.project_id)
           from path_events pe
          where pe.event_name = 'sdk_seen_live'
            and pe.ts >= wk.week_start and pe.ts < wk.week_end)                     as sdk_seen_live,
        (select count(distinct pe.project_id)
           from path_events pe
          where pe.event_name = 'first_real_report'
            and pe.ts >= wk.week_start and pe.ts < wk.week_end)                     as first_real_report,
        (select count(distinct pe.project_id)
           from path_events pe
          where pe.event_name = 'first_diagnosis_viewed'
            and pe.ts >= wk.week_start and pe.ts < wk.week_end)                     as first_diagnosis_viewed,
        (select count(distinct pe.project_id)
           from path_events pe
          where pe.event_name = 'first_fix_dispatched'
            and pe.ts >= wk.week_start and pe.ts < wk.week_end)                     as first_fix_dispatched,
        (select count(distinct pe.project_id)
           from path_events pe
          where pe.event_name = 'first_fix_merged'
            and pe.ts >= wk.week_start and pe.ts < wk.week_end)                     as first_fix_merged
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
                    'week_start',             to_char(w.week_start, 'YYYY-MM-DD'),
                    'visits',                 w.visits,
                    'visits_spam_excluded',   w.visits_spam_excluded,
                    'visits_consented',       w.visits_consented,
                    'signups',                w.signups,
                    'projects',               w.projects,
                    'keys',                   w.keys,
                    'sdk_installed',          w.sdk_installed,
                    'activated',              w.activated,
                    'activated_opened',       w.activated_opened,
                    'fix_pulled',             w.fix_pulled,
                    'habit',                  w.habit,
                    'paid',                   w.paid,
                    'loop_impressions',       w.loop_impressions,
                    'loop_clicks',            w.loop_clicks,
                    'loop_signups',           w.loop_signups,
                    'sdk_seen_localhost',     w.sdk_seen_localhost,
                    'sdk_seen_live',          w.sdk_seen_live,
                    'first_real_report',      w.first_real_report,
                    'first_diagnosis_viewed', w.first_diagnosis_viewed,
                    'first_fix_dispatched',   w.first_fix_dispatched,
                    'first_fix_merged',       w.first_fix_merged
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
  'Mushi company funnel per ISO week (newest first) + signups/activated by source (signup_source, else the first-touch utm_source stored as signup_first_touch). Excludes operator_users and synthetic accounts everywhere, tester-only accounts from signups, and projects in complimentary organizations from every project count; visits = cookieless page views (landing_page_views_daily) without referrer spam, filtered on ?src= when a source is given; visits_spam_excluded = the spam views left out; visits_consented = distinct anon ids with landing_view or docs_page_view (the earlier visits); keys = first key leaving the console; activated = first real end-user report (is_activation_candidate_report: no wizard, localhost, test, seed, hand-filed or Mushi-filed report); activated_opened = owner opened such a report within 7 days of signup; habit = report_opened, fix_context_pulled or fix_dispatched (console or MCP) in 3 of 4 weeks; loop_impressions / loop_clicks = widget-mark events across all projects except the self project; loop_signups = signups whose loop_ref is a widget loop ref; sdk_seen_localhost / sdk_seen_live / first_real_report / first_diagnosis_viewed / first_fix_dispatched / first_fix_merged = outside projects reaching that new-user step that week (server product_events, one per project; a first_real_report whose report fails is_activation_candidate_report is left out). Service role only — GET /v1/admin/growth/funnel behind requireOperator.';

-- Service role only, as before.
revoke all on function public.company_funnel_weekly(integer, text) from public, anon, authenticated;
grant execute on function public.company_funnel_weekly(integer, text) to service_role;

-- ── 3. gtm_daily_scorecard(), re-declared ───────────────────────────────────
create or replace function public.gtm_daily_scorecard(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 14), 90));
  v_today date    := (now() at time zone 'utc')::date;
  v_start date;
  v_self  uuid;
begin
  v_start := v_today - (v_days - 1);

  select nullif(value, '')::uuid
    into v_self
    from public.mushi_runtime_config
   where key = 'self_project_id';

  return (
    with d as (
      select gs::date as day
      from generate_series(v_start::timestamp, v_today::timestamp, interval '1 day') as gs
    ),
    op as (
      select user_id from public.operator_users
    ),
    -- Builder signups, as company_funnel_weekly's people CTE: operators,
    -- synthetic accounts and tester-only accounts out. Source = first touch
    -- (the ?src= tag), else signup_source: the reverse of the weekly RPC
    -- (see 20261028210000_landing_page_views.sql).
    people as (
      select u.id,
             (u.created_at at time zone 'utc')::date as day,
             src.source
      from auth.users u
      cross join lateral (
        select coalesce(
                 nullif(u.raw_user_meta_data ->> 'signup_first_touch', ''),
                 nullif(nullif(u.raw_user_meta_data ->> 'signup_source', ''), 'unknown'),
                 'unknown') as source
      ) src
      where not exists (select 1 from op where op.user_id = u.id)
        and not exists (select 1 from public.synthetic_accounts sa where sa.user_id = u.id)
        and not (
          (   exists (select 1 from public.mushi_testers t where t.auth_user_id = u.id)
           or coalesce(u.raw_user_meta_data ->> 'signup_track', '') = 'tester')
          and not exists (select 1 from public.projects owned where owned.owner_id = u.id)
        )
    ),
    -- Page views without referrer spam. Spam rows stay in the table; they
    -- are only left out here.
    views as (
      select v.day,
             coalesce(nullif(v.src, ''), 'unknown') as source,
             sum(v.views)::bigint as n
      from public.landing_page_views_daily v
      where v.day >= v_start
        and not public.is_spam_referrer_host(v.referrer_host)
      group by 1, 2
    ),
    spam as (
      select coalesce(sum(v.views), 0)::bigint as n
      from public.landing_page_views_daily v
      where v.day >= v_start
        and public.is_spam_referrer_host(v.referrer_host)
    ),
    signups as (
      select p.day, p.source
      from people p
      where p.day >= v_start
    ),
    -- One 'activated' row per organization (dedup key activated:<org>).
    -- The owner is the event's end user (resolveSelfEndUser keys
    -- external_user_id on auth.users.id); joining people drops operators.
    activated as (
      select (e.ts at time zone 'utc')::date as day, p.source
      from public.product_events e
      join public.end_users eu on eu.id = e.end_user_id
      join people p on p.id::text = eu.external_user_id
      where v_self is not null
        and e.project_id = v_self
        and e.event_name = 'activated'
        and e.ts >= v_start::timestamptz
        -- An activation emitted before classify-report knew the rule (the
        -- cli://wizard test on 2026-11-10) is left out when its report fails
        -- it. The row is kept; a report that is gone still counts.
        and not exists (
          select 1
          from public.reports r
          where r.id::text = e.properties ->> 'report_id'
            and not public.is_activation_candidate_report(r.source, r.custom_metadata, r.environment ->> 'url'))
    ),
    -- Outside projects, as company_funnel_weekly's proj CTE: owned by a
    -- person in people, organization owner not an operator, organization not
    -- complimentary (the owner's own apps).
    outside_projects as (
      select p.id, ppl.source
      from public.projects p
      join people ppl on ppl.id = p.owner_id
      left join public.organizations o on o.id = p.organization_id
      where not exists (select 1 from op where op.user_id = o.owner_id)
        and coalesce(o.billing_mode, '') <> 'complimentary'
    ),
    -- sdk_seen_live: one product event per host project ever (dedup key
    -- 'sdk_seen_live:<project id>'), written into the self project.
    seen_live as (
      select (e.ts at time zone 'utc')::date as day, op2.source
      from public.product_events e
      join outside_projects op2 on op2.id::text = e.properties ->> 'project_id'
      where v_self is not null
        and e.project_id = v_self
        and e.event_name = 'sdk_seen_live'
        and e.ts >= v_start::timestamptz
    ),
    sources as (
      select source from views
      union select source from signups
      union select source from activated
      union select source from seen_live
    )
    select jsonb_build_object(
      'window_start', v_start,
      'self_project_configured', v_self is not null,
      'spam_views_excluded', (select n from spam),
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'day', d.day,
                 'page_views',    coalesce((select sum(n) from views v where v.day = d.day), 0),
                 'signups',       (select count(*) from signups s where s.day = d.day),
                 'sdk_seen_live', (select count(*) from seen_live l where l.day = d.day),
                 'activated',     (select count(*) from activated a where a.day = d.day))
               order by d.day)
        from d), '[]'::jsonb),
      'by_src', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'src', s.source,
                 'page_views',    coalesce((select sum(n) from views v where v.source = s.source), 0),
                 'signups',       (select count(*) from signups x where x.source = s.source),
                 'sdk_seen_live', (select count(*) from seen_live l where l.source = s.source),
                 'activated',     (select count(*) from activated a where a.source = s.source))
               order by s.source)
        from sources s), '[]'::jsonb)
    )
  );
end;
$fn$;

revoke all on function public.gtm_daily_scorecard(integer) from public, anon, authenticated;
grant execute on function public.gtm_daily_scorecard(integer) to service_role;

notify pgrst, 'reload schema';
