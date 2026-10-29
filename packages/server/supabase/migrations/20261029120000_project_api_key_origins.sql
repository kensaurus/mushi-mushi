-- =============================================================================
-- Where each SDK key checked in from, per kind of origin (2026-10-29).
-- docs/plan-simplicity-2026-10.md, Phase 0 and §4b row 1.
--
-- Why: project_api_keys.last_seen_origin keeps only the latest origin. Every
-- outside key that ever checked in was last seen from localhost, but a later
-- localhost ping also hides an earlier live check-in, so "never live" cannot
-- be proven. This table keeps one row per (key, kind) with first and last
-- seen, so the Phase 2 check `sdk_localhost_only` and the new funnel steps can
-- tell "works on my machine" from "live users can report".
--
--   project_api_key_origins  one row per key and origin_kind
--                            (localhost | live_web | native | server | unknown,
--                            _shared/sdk-origin.ts classifySdkOrigin). The
--                            sample is scheme + host (+ port) only, never a
--                            path, query or credentials. Service role only.
--   record_api_key_origin()  the ingest heartbeat's one write (auth.ts
--                            recordSdkHeartbeat). Returns whether this was the
--                            key's first check-in of that kind and the
--                            project's first, which emits sdk_seen_localhost /
--                            sdk_seen_live once per project. Service role only.
--   backfill                 each key's current last_seen_origin, classified
--                            with the same rules, so an existing app that is
--                            already live is not stamped "first seen live" at
--                            its next check-in. No events are emitted here.
--   company_funnel_weekly()  re-declared from 20260922000100 (every output key
--                            unchanged) with two changes:
--                              * projects in organizations with billing_mode =
--                                'complimentary' (the owner's own apps) leave
--                                every project-derived count, like /proof's
--                                public_scoreboard() keeps them apart;
--                                synthetic fresh-eyes accounts are named
--                                explicitly too (they are also operator_users);
--                              * six weekly keys for the new-user path, each the
--                                number of distinct outside projects that reached
--                                the step that week: sdk_seen_localhost,
--                                sdk_seen_live, first_real_report,
--                                first_diagnosis_viewed, first_fix_dispatched,
--                                first_fix_merged (server product_events, one
--                                per project, _shared/funnel-steps.ts).
--
-- Additive: one new table, one new function, one re-declared function.
-- Idempotent: IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING.
--
-- Verify after applying:
--   select relrowsecurity from pg_class where relname = 'project_api_key_origins';             -- t
--   select count(*) from pg_policies where tablename = 'project_api_key_origins';              -- 0
--   select has_table_privilege('authenticated', 'public.project_api_key_origins', 'select');   -- f
--   select has_function_privilege('anon', 'public.record_api_key_origin(uuid, text, text, integer)', 'execute'); -- f
--   select origin_kind, count(*) from public.project_api_key_origins group by 1;
--   select jsonb_array_length(public.company_funnel_weekly(2, null) -> 'weeks');               -- 2
-- =============================================================================

-- ── 1. project_api_key_origins ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_api_key_origins (
  key_id        uuid        NOT NULL REFERENCES public.project_api_keys(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  origin_kind   text        NOT NULL
                CHECK (origin_kind IN ('localhost', 'live_web', 'native', 'server', 'unknown')),
  origin_sample text
                -- scheme://host[:port] and nothing else: no path, query, fragment or userinfo.
                CHECK (origin_sample IS NULL
                       OR (char_length(origin_sample) <= 200 AND origin_sample ~ '^[a-z][a-z0-9+.-]*://[^/?#@[:space:]]+$')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  seen_count    integer     NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  PRIMARY KEY (key_id, origin_kind)
);

CREATE INDEX IF NOT EXISTS idx_project_api_key_origins_project_kind
  ON public.project_api_key_origins (project_id, origin_kind, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_project_api_key_origins_project_last_seen
  ON public.project_api_key_origins (project_id, last_seen_at DESC);

ALTER TABLE public.project_api_key_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_api_key_origins FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.project_api_key_origins IS
  'Where each SDK key checked in from: one row per (key, origin_kind) with first and last seen (plan-simplicity Phase 0). Written by the ingest heartbeat through record_api_key_origin(). origin_sample is scheme + host (+ port) only, never a path, query or credentials. Service role only: RLS on, no policies.';
COMMENT ON COLUMN public.project_api_key_origins.origin_kind IS
  'localhost (dev machine, report-origin.ts rules), live_web (other http(s) origin), native (Capacitor/Android webview scheme, port-less loopback, React Native or a native HTTP stack), server (Node SDK or a non-browser client), unknown.';
COMMENT ON COLUMN public.project_api_key_origins.seen_count IS
  'Throttled check-ins, not requests: at most one per key, kind and 5 minutes is counted.';

-- ── 2. record_api_key_origin() ──────────────────────────────────────────────
-- One statement per check-in on the hot path, each a primary-key or index
-- lookup. The project comes from the key row, so a caller cannot file a check-in
-- under another project. A check-in inside p_min_gap_seconds of the last one
-- for the same key and kind writes nothing (the per-isolate throttle in
-- auth.ts already drops most of those).
CREATE OR REPLACE FUNCTION public.record_api_key_origin(
  p_key_id          uuid,
  p_origin_kind     text,
  p_origin_sample   text,
  p_min_gap_seconds integer DEFAULT 300
)
RETURNS TABLE (project_id uuid, first_for_key boolean, first_for_project boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_project   uuid;
  v_first_prj boolean;
  v_inserted  boolean;
BEGIN
  SELECT k.project_id INTO v_project
    FROM public.project_api_keys k
   WHERE k.id = p_key_id;
  IF v_project IS NULL THEN
    RETURN;
  END IF;

  v_first_prj := NOT EXISTS (
    SELECT 1 FROM public.project_api_key_origins o
     WHERE o.project_id = v_project AND o.origin_kind = p_origin_kind
  );

  INSERT INTO public.project_api_key_origins AS t
         (key_id, project_id, origin_kind, origin_sample)
  VALUES (p_key_id, v_project, p_origin_kind,
          -- A sample that is not exactly scheme://host[:port] is dropped, not stored.
          CASE WHEN char_length(p_origin_sample) <= 200
                AND p_origin_sample ~ '^[a-z][a-z0-9+.-]*://[^/?#@[:space:]]+$'
               THEN p_origin_sample END)
  ON CONFLICT (key_id, origin_kind) DO UPDATE
     SET last_seen_at  = now(),
         seen_count    = t.seen_count + 1,
         origin_sample = coalesce(excluded.origin_sample, t.origin_sample)
   WHERE t.last_seen_at < now() - make_interval(secs => greatest(coalesce(p_min_gap_seconds, 300), 0))
  RETURNING (xmax = 0) INTO v_inserted;

  -- v_inserted is NULL when the conflict's WHERE skipped the update.
  RETURN QUERY SELECT v_project, coalesce(v_inserted, false), coalesce(v_inserted, false) AND v_first_prj;
END;
$fn$;

COMMENT ON FUNCTION public.record_api_key_origin(uuid, text, text, integer) IS
  'Ingest heartbeat write into project_api_key_origins (auth.ts recordSdkHeartbeat). first_for_project drives the sdk_seen_localhost / sdk_seen_live funnel steps. Service role only.';

REVOKE ALL ON FUNCTION public.record_api_key_origin(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_api_key_origin(uuid, text, text, integer) TO service_role;

-- ── 3. Backfill from last_seen_origin ───────────────────────────────────────
-- The same rules as _shared/sdk-origin.ts for an origin that is set (the local
-- pattern is report-origin.ts LOCAL_DEV_URL_PATTERN, POSIX ERE on purpose).
-- Keys whose latest check-in sent no Origin are left out: their kind depends
-- on headers that were never stored. first_seen_at is the stored last_seen_at,
-- the earliest time Mushi can prove.
WITH src AS (
  SELECT k.id AS key_id,
         k.project_id,
         k.last_seen_at,
         lower(substring(btrim(k.last_seen_origin) FROM '^([A-Za-z][A-Za-z0-9+.-]*://[^/?#]+)')) AS head
    FROM public.project_api_keys k
   WHERE k.project_id IS NOT NULL
     AND k.last_seen_at IS NOT NULL
     AND k.last_seen_origin IS NOT NULL
),
cleaned AS (
  -- Drop userinfo (user:pass@) so only scheme + host (+ port) remains.
  SELECT key_id, project_id, last_seen_at,
         regexp_replace(head, '^([a-z][a-z0-9+.-]*://)[^@]*@', '\1') AS sample
    FROM src
   WHERE head IS NOT NULL
),
classified AS (
  SELECT key_id, project_id, last_seen_at, sample,
         CASE
           WHEN sample ~ '^(capacitor|ionic|android-app)://' THEN 'native'
           WHEN sample !~ '^https?://' THEN NULL
           WHEN sample ~* ('^[a-z][a-z0-9+.-]*://('
                         || '(localhost|127\.[0-9.]+|0\.0\.0\.0|\[::1\]):[0-9]+'
                         || '|(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9.]+(:[0-9]+)?'
                         || '|[a-z0-9.-]+\.(localhost|local|test)(:[0-9]+)?'
                         || ')([/?#]|$)') THEN 'localhost'
           WHEN sample ~ '^https?://(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$' THEN 'native'
           ELSE 'live_web'
         END AS origin_kind
    FROM cleaned
)
INSERT INTO public.project_api_key_origins
       (key_id, project_id, origin_kind, origin_sample, first_seen_at, last_seen_at, seen_count)
SELECT key_id, project_id, origin_kind,
       CASE WHEN char_length(sample) <= 200 AND sample ~ '^[a-z][a-z0-9+.-]*://[^/?#@[:space:]]+$' THEN sample END,
       last_seen_at, last_seen_at, 1
  FROM classified
 WHERE origin_kind IS NOT NULL
ON CONFLICT (key_id, origin_kind) DO NOTHING;

-- ── 4. company_funnel_weekly(), re-declared ─────────────────────────────────
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
  'Mushi company funnel per ISO week (newest first) + signups/activated by source (signup_source, else the first-touch utm_source stored as signup_first_touch). Excludes operator_users and synthetic accounts everywhere, tester-only accounts from signups, and projects in complimentary organizations from every project count; visits = distinct anon ids with landing_view or docs_page_view; keys = first key leaving the console; activated = first real report; activated_opened = owner opened a real report within 7 days of signup; habit = report_opened, fix_context_pulled or fix_dispatched (console or MCP) in 3 of 4 weeks; loop_impressions / loop_clicks = widget-mark events across all projects except the self project; loop_signups = signups whose loop_ref is a widget loop ref; sdk_seen_localhost / sdk_seen_live / first_real_report / first_diagnosis_viewed / first_fix_dispatched / first_fix_merged = outside projects reaching that new-user step that week (server product_events, one per project). Service role only — GET /v1/admin/growth/funnel behind requireOperator.';

-- Unchanged: service role only.
revoke all on function public.company_funnel_weekly(integer, text) from public, anon, authenticated;
grant execute on function public.company_funnel_weekly(integer, text) to service_role;

notify pgrst, 'reload schema';
