-- ============================================================================
-- FILE: 20260921000002_company_funnel_rpc.sql
-- PURPOSE: Mushi's own growth funnel as one RPC (company_funnel_weekly), the
--          operator exclusion table it reads, the self-project pointer in
--          mushi_runtime_config, and a wider setup_funnel_events event_name
--          CHECK for the console/MCP steps _shared/setup-funnel.ts already
--          types (mcp_setup_done / mcp_first_tool_call were being rejected by
--          the original 9-value CHECK — a silent fail-open in the emitter).
--
-- Depends on: 20260921000001_product_events.sql (product_events),
--             20260622013932_setup_funnel_events.sql (setup_funnel_events),
--             20260418005900_pipeline_recovery_cron.sql (mushi_runtime_config).
--
-- After applying: the lead inserts founder ids into public.operator_users
-- (mirroring secret MUSHI_OPERATOR_USER_IDS) and sets
-- mushi_runtime_config.self_project_id (mirroring secret MUSHI_SELF_PROJECT_ID).
-- Until self_project_id is set, visits / fix_pulled / habit read as 0 and the
-- RPC reports self_project_configured = false.
--
-- Idempotent: every block uses IF NOT EXISTS / ON CONFLICT / OR REPLACE /
-- drop-then-add. Three DISTINCT dollar-quote tags on purpose ($chk$, $fn$).
-- ============================================================================

-- ── 1. Operator (founder / staff) exclusion list ────────────────────────────
-- Service role only: RLS enabled with NO policies, and every table privilege
-- revoked from the PostgREST roles. The lead inserts rows directly.
create table if not exists public.operator_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.operator_users is
  'auth.users ids excluded from company_funnel_weekly() counts (founders / staff). Service role only; mirror of the MUSHI_OPERATOR_USER_IDS edge secret.';

alter table public.operator_users enable row level security;
revoke all on table public.operator_users from public, anon, authenticated;

-- ── 2. Self project pointer ─────────────────────────────────────────────────
-- Mirrors the MUSHI_SELF_PROJECT_ID edge secret so SQL can find Mushi's own
-- product_events rows. Empty string = not configured (nullif() below).
insert into public.mushi_runtime_config (key, value)
values ('self_project_id', '')
on conflict (key) do nothing;

-- ── 3. setup_funnel_events: widen the event_name CHECK ──────────────────────
-- The original constraint was declared inline (auto-named
-- setup_funnel_events_event_name_check). Drop whatever CHECK currently
-- mentions event_name by catalog lookup so a differently-named constraint
-- cannot linger and reject the new values, then re-add under a fixed name.
do $chk$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.setup_funnel_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%event_name%'
  loop
    execute format('alter table public.setup_funnel_events drop constraint %I', r.conname);
  end loop;
end;
$chk$;

alter table public.setup_funnel_events
  add constraint setup_funnel_events_event_name_check
  check (event_name in (
    -- original CLI wizard steps
    'cli_auth_started',
    'cli_auth_approved',
    'cli_auth_denied',
    'cli_auth_expired',
    'cli_auth_token_claimed',
    'cli_project_created',
    'cli_key_minted',
    'wizard_env_written',
    'sdk_first_heartbeat',
    -- console onboarding steps
    'console_project_created',
    'console_key_minted',
    'test_report_sent',
    'diagnosis_viewed',
    -- MCP steps (typed in _shared/setup-funnel.ts + allowed by POST /v1/cli/funnel
    -- since 2026-06 but never in the CHECK)
    'mcp_setup_done',
    'mcp_first_tool_call'
  ));

-- ── 4. company_funnel_weekly(p_weeks, p_source) ─────────────────────────────
-- One row per ISO week (Monday start, newest first) over the last p_weeks
-- weeks. Every people/project-derived count excludes operator_users (as
-- project owner or as owner of the project's organization) and, when
-- p_source is set, keeps only users whose auth.users.raw_user_meta_data
-- ->> 'signup_source' matches. Self-project counts (visits, fix_pulled,
-- habit) are anonymous/console-side and are not source-filterable.
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
    -- Non-operator console users with their acquisition source. No time
    -- filter here: projects join back to this set by owner regardless of
    -- when the owner signed up.
    people as (
      select u.id,
             u.created_at,
             coalesce(u.raw_user_meta_data ->> 'signup_source', 'unknown') as source
      from auth.users u
      where not exists (select 1 from op where op.user_id = u.id)
        and (v_source is null or u.raw_user_meta_data ->> 'signup_source' = v_source)
    ),
    -- Projects owned by a non-operator whose organization owner is also not
    -- an operator (legacy ownerless-org projects pass through the left join).
    proj as (
      select p.id, p.created_at, p.owner_id, ppl.source
      from public.projects p
      join people ppl on ppl.id = p.owner_id
      left join public.organizations o on o.id = p.organization_id
      where not exists (select 1 from op where op.user_id = o.owner_id)
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
    -- Mushi's own product_events (landing, console, MCP) under the self project.
    self_events as (
      select e.event_name,
             e.ts,
             e.anon_id,
             e.end_user_id,
             coalesce(e.end_user_id::text, e.anon_id) as person
      from public.product_events e
      where v_self is not null
        and e.project_id = v_self
        and e.ts >= v_habit_start
        and e.ts <  v_end
        and e.event_name in ('landing_view', 'fix_context_pulled', 'report_opened')
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
        (select count(distinct k.project_id)
           from public.project_api_keys k
           join proj on proj.id = k.project_id
          where k.created_at >= wk.week_start and k.created_at < wk.week_end)      as keys,
        (select count(distinct f.project_id)
           from public.setup_funnel_events f
           join proj on proj.id = f.project_id
          where f.event_name = 'sdk_first_heartbeat'
            and f.created_at >= wk.week_start and f.created_at < wk.week_end)      as sdk_installed,
        (select count(*)
           from first_reports fr
          where fr.first_at >= wk.week_start and fr.first_at < wk.week_end)        as activated,
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
                    'week_start',    to_char(w.week_start, 'YYYY-MM-DD'),
                    'visits',        w.visits,
                    'signups',       w.signups,
                    'projects',      w.projects,
                    'keys',          w.keys,
                    'sdk_installed', w.sdk_installed,
                    'activated',     w.activated,
                    'fix_pulled',    w.fix_pulled,
                    'habit',         w.habit,
                    'paid',          w.paid
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
  'Mushi company funnel per ISO week (newest first) + signups/activated by signup_source. Excludes operator_users. Service role only — called by GET /v1/admin/growth/funnel behind requireOperator.';

-- Service role only. The edge route already runs on the service client and
-- enforces the operator gate; granting EXECUTE to `authenticated` would let
-- any signed-in user read company-wide aggregates through PostgREST /rpc —
-- the same leak class 20260622072228 closed for get_setup_funnel_counts_7d.
revoke all on function public.company_funnel_weekly(integer, text) from public, anon, authenticated;
grant execute on function public.company_funnel_weekly(integer, text) to service_role;

-- Flush PostgREST's schema + privilege caches so the new table/function and
-- the REVOKEs are visible immediately (mirrors 20260622072228).
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
