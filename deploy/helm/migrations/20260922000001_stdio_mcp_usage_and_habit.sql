-- ============================================================================
-- 20260922000001_stdio_mcp_usage_and_habit
--
-- 1. mcp_tool_invocations: one row per stdio MCP tool call.
--    The stdio server (npx @mushi-mushi/mcp) now tags each API request with the
--    tool and a per-call id (X-Mushi-Mcp-Invocation, stored as request_id).
--    A tool that makes several requests shares the id; this partial unique
--    index turns the repeats into 23505, which _shared/mcp-tool-audit.ts
--    treats as "already recorded". Hosted rows are unaffected.
--
-- 2. company_funnel_weekly: habit also counts fix_dispatched.
--    docs/plan-gtm.md defines habit as report opened, fix context pulled or fix
--    dispatched, from the console or an MCP client. The RPC counted only the
--    first two, so a user who dispatched fixes every week never reached habit.
--    HABIT_EVENTS in packages/core/src/analytics-taxonomy.ts is the same set
--    (pinned by packages/server/src/__tests__/company-funnel-habit-contract.test.ts).
--    The body is 20260921000010's (identical to prod prosrc apart from comment
--    lines) with fix_dispatched added to self_events and habit_weeks.
-- ============================================================================

create unique index if not exists mcp_tool_invocations_stdio_request_uidx
  on public.mcp_tool_invocations (request_id)
  where transport = 'stdio' and request_id is not null;

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
        and e.event_name in ('landing_view', 'fix_context_pulled', 'report_opened', 'fix_dispatched')
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
  'Mushi company funnel per ISO week (newest first) + signups/activated by signup_source. Excludes operator_users everywhere and tester-only accounts from signups; keys = first key leaving the console; activated_opened = owner opened a real report within 7 days of signup; habit = report_opened, fix_context_pulled or fix_dispatched (console or MCP) in 3 of 4 weeks. Service role only — GET /v1/admin/growth/funnel behind requireOperator.';

-- Unchanged: service role only.
revoke all on function public.company_funnel_weekly(integer, text) from public, anon, authenticated;
grant execute on function public.company_funnel_weekly(integer, text) to service_role;

notify pgrst, 'reload schema';
