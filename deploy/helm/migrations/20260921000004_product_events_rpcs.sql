-- ============================================================================
-- FILE: 20260921000004_product_events_rpcs.sql
-- PURPOSE: Users & Funnels read RPCs over product_events
--          (docs/plan-gtm.md → Workstream A, week 2). Five functions, all
--          jsonb-returning, stable, security definer, service_role only —
--          the edge layer (api/routes/events-admin.ts) enforces project
--          ownership before calling them.
--
--   product_events_summary(p_project_id, p_window_days)
--   product_funnel(p_project_id, p_steps, p_from, p_to, p_window, p_breakdown)
--   product_paths(p_project_id, p_from_event, p_from, p_to, p_limit)
--   product_people(p_project_id, p_filter, p_limit, p_before)
--   product_retention(p_project_id, p_weeks, p_return_event)
--
-- Person key everywhere: coalesce(end_user_id::text, anon_id)  — matches the
-- product_events_project_person_ts index from 20260921000001.
--
-- Depends on: 20260921000001_product_events.sql, 20260517000000 (end_users).
-- Idempotent: CREATE OR REPLACE throughout. Distinct dollar-quote tags.
-- A seed-and-assert fixture is at the bottom (commented) for post-apply
-- verification.
-- ============================================================================

-- ── 1. product_events_summary ───────────────────────────────────────────────
-- { window_days, events_total, persons, identified, anonymous,
--   events_per_day:[{day:'YYYY-MM-DD', count}], top_events:[{name,count,persons}] (≤20) }
-- Window = the last p_window_days calendar days (UTC) including today.
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
           (count(distinct person) filter (where end_user_id is null))::bigint     as anonymous
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
  top as (
    select event_name,
           count(*)::bigint               as cnt,
           count(distinct person)::bigint as persons
      from ev
     group by event_name
     order by cnt desc, event_name
     limit 20
  )
  select jsonb_build_object(
           'window_days',    v_days,
           'events_total',   t.events_total,
           'persons',        t.persons,
           'identified',     t.identified,
           'anonymous',      t.anonymous,
           'events_per_day', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'count', cnt) order by day), '[]'::jsonb) from per_day),
           'top_events',     (select coalesce(jsonb_agg(jsonb_build_object('name', event_name, 'count', cnt, 'persons', persons) order by cnt desc, event_name), '[]'::jsonb) from top)
         )
    into v_result
    from totals t;

  return v_result;
end;
$fn$;

comment on function public.product_events_summary(uuid, integer) is
  'Users & Funnels overview for one project over the last N days: totals, identified vs anonymous persons, events per day, top 20 events. Service role only (GET /v1/admin/events/summary).';

revoke all on function public.product_events_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.product_events_summary(uuid, integer) to service_role;

-- ── 2. product_funnel ───────────────────────────────────────────────────────
-- { steps:[{name, entered, converted, pct, median_secs}],
--   breakdown:[{value, entered, steps:[...same]}] }
--
-- Semantics (per person = coalesce(end_user_id::text, anon_id)):
--   * step 1   = the person's FIRST p_steps[1] event with p_from <= ts < p_to
--   * step n>1 = the person's first p_steps[n] event with
--                ts > step(n-1).ts and ts <= step1.ts + p_window
--   * converted(n) = persons that reached step n
--   * entered(n)   = persons that reached step n-1 (entered(1) = converted(1))
--   * pct(n)       = converted(n) / converted(1) × 100, one decimal
--   * median_secs  = median of (step n ts − step 1 ts) over converters; null when none
--   * breakdown    = groups by the STEP-1 event's properties ->> p_breakdown
--                    ('(none)' when missing); top 10 values by entered, the
--                    rest collapse into 'other'. [] when p_breakdown is null.
-- Raises 22023 for 0 or >8 steps, duplicate step names, or a non-positive window.
-- Implementation: one dynamic query with a chain of LEFT JOIN LATERAL, one
-- per step. Only the loop index is interpolated; all values are bound.
create or replace function public.product_funnel(
  p_project_id uuid,
  p_steps      text[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_window     interval default interval '7 days',
  p_breakdown  text     default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_n         integer     := coalesce(array_length(p_steps, 1), 0);
  v_window    interval    := coalesce(p_window, interval '7 days');
  v_from      timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to        timestamptz := coalesce(p_to, now());
  v_bd        text        := nullif(trim(coalesce(p_breakdown, '')), '');
  v_i         integer;
  v_chain     text := '';
  v_cols      text := '';
  v_steps_sql text := '';
  v_sql       text;
  v_result    jsonb;
begin
  if v_n < 1 or v_n > 8 then
    raise exception 'product_funnel: p_steps must contain 1..8 event names (got %)', v_n
      using errcode = '22023';
  end if;
  if (select count(distinct s) from unnest(p_steps) as s) <> v_n then
    raise exception 'product_funnel: p_steps must be distinct' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_steps) as s where s !~ '^[a-z][a-z0-9_]{1,63}$') then
    raise exception 'product_funnel: invalid event name in p_steps' using errcode = '22023';
  end if;
  if v_window <= interval '0' then
    raise exception 'product_funnel: p_window must be positive' using errcode = '22023';
  end if;
  if v_from >= v_to then
    raise exception 'product_funnel: p_from must be before p_to' using errcode = '22023';
  end if;

  -- Lateral chain for steps 2..n.
  for v_i in 2..v_n loop
    v_chain := v_chain || format(
      ' left join lateral (select min(e.ts) as ts from ev e where e.person = s1.person and e.idx = %1$s and e.ts > s%2$s.ts and e.ts <= s1.ts + $5) s%1$s on true',
      v_i, v_i - 1);
    v_cols := v_cols || format(', s%1$s.ts as s%1$s_ts', v_i);
  end loop;

  -- Per-step aggregate, reused for the total row and each breakdown group.
  for v_i in 1..v_n loop
    v_steps_sql := v_steps_sql
      || case when v_i > 1 then ', ' else '' end
      || format(
        $agg$jsonb_build_object(
          'name', $1[%1$s],
          'entered', count(s%2$s_ts),
          'converted', count(s%1$s_ts),
          'pct', case when count(s1_ts) = 0 then 0 else round(100.0 * count(s%1$s_ts) / count(s1_ts), 1) end,
          'median_secs', case when count(s%1$s_ts) = 0 then null
                              else round((percentile_cont(0.5) within group (order by extract(epoch from (s%1$s_ts - s1_ts))::double precision))::numeric, 1) end
        )$agg$,
        v_i, greatest(v_i - 1, 1));
  end loop;

  v_sql := format($q$
    with ev as (
      select e.ts, e.properties,
             coalesce(e.end_user_id::text, e.anon_id) as person,
             array_position($1, e.event_name)          as idx
        from public.product_events e
       where e.project_id = $2
         and e.event_name = any($1)
         and e.ts >= $3
         and e.ts <  $4 + $5
         and coalesce(e.end_user_id::text, e.anon_id) is not null
    ),
    s1 as (
      select distinct on (person) person, ts,
             case when $6::text is null then null
                  else coalesce(properties ->> $6::text, '(none)') end as bd
        from ev
       where idx = 1 and ts < $4
       order by person, ts
    ),
    persons as (
      select s1.person, s1.bd, s1.ts as s1_ts %1$s
        from s1 %2$s
    ),
    top_bd as (
      select bd from persons where $6::text is not null
       group by bd order by count(*) desc, bd limit 10
    ),
    persons_bd as (
      select p.*, case when p.bd in (select bd from top_bd) then p.bd else 'other' end as bdv
        from persons p
    )
    select jsonb_build_object(
      'steps', (select jsonb_build_array(%3$s) from persons),
      'breakdown', case when $6::text is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('value', g.bdv, 'entered', g.entered, 'steps', g.steps)
                         order by g.entered desc, g.bdv)
          from (
            select bdv, count(s1_ts) as entered, jsonb_build_array(%3$s) as steps
              from persons_bd
             group by bdv
          ) g
      ), '[]'::jsonb) end
    )
  $q$, v_cols, v_chain, v_steps_sql);

  execute v_sql into v_result using p_steps, p_project_id, v_from, v_to, v_window, v_bd;
  return v_result;
end;
$fn$;

comment on function public.product_funnel(uuid, text[], timestamptz, timestamptz, interval, text) is
  'Ordered funnel over product_events (≤8 distinct steps, step n = first occurrence after step n-1 within step1 + window). Optional breakdown by a step-1 property (top 10 + other). Service role only (GET /v1/admin/events/funnel).';

revoke all on function public.product_funnel(uuid, text[], timestamptz, timestamptz, interval, text) from public, anon, authenticated;
grant execute on function public.product_funnel(uuid, text[], timestamptz, timestamptz, interval, text) to service_role;

-- ── 3. product_paths ────────────────────────────────────────────────────────
-- { from_event, total, exits, next:[{name, count, pct}] }
--   stream = session_id, falling back to the person key when null
--   total  = occurrences of p_from_event in [p_from, p_to)
--   exits  = occurrences with no following event in the stream
--   next   = following events by count (≤ p_limit); pct is relative to total,
--            so the pcts plus exits/total sum to 100.
create or replace function public.product_paths(
  p_project_id uuid,
  p_from_event text,
  p_from       timestamptz,
  p_to         timestamptz,
  p_limit      integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_from   timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to     timestamptz := coalesce(p_to, now());
  v_limit  integer     := greatest(1, least(coalesce(p_limit, 10), 50));
  v_result jsonb;
begin
  with ev as (
    select e.id, e.event_name, e.ts,
           coalesce(e.session_id, e.end_user_id::text, e.anon_id) as stream
      from public.product_events e
     where e.project_id = p_project_id
       and e.ts >= v_from
       and e.ts <  v_to
  ),
  seq as (
    select event_name,
           lead(event_name) over (partition by stream order by ts, id) as next_name
      from ev
     where stream is not null
  ),
  origins as (
    select next_name from seq where event_name = p_from_event
  ),
  nxt as (
    select next_name as name, count(*)::bigint as cnt
      from origins
     where next_name is not null
     group by next_name
     order by cnt desc, next_name
     limit v_limit
  ),
  tot as (
    select count(*)::bigint                                   as total,
           (count(*) filter (where next_name is null))::bigint as exits
      from origins
  )
  select jsonb_build_object(
           'from_event', p_from_event,
           'total',      t.total,
           'exits',      t.exits,
           'next', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'name',  name,
                      'count', cnt,
                      'pct',   case when t.total = 0 then 0 else round(100.0 * cnt / t.total, 1) end
                    ) order by cnt desc, name), '[]'::jsonb)
               from nxt
           )
         )
    into v_result
    from tot t;

  return v_result;
end;
$fn$;

comment on function public.product_paths(uuid, text, timestamptz, timestamptz, integer) is
  'What happens right after p_from_event: next events by count within the same session (person when no session). Service role only (GET /v1/admin/events/paths).';

revoke all on function public.product_paths(uuid, text, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.product_paths(uuid, text, timestamptz, timestamptz, integer) to service_role;

-- ── 4. product_people ───────────────────────────────────────────────────────
-- { people:[{ end_user_id, external_user_id, display_name, first_seen_at,
--             last_seen_at, event_count, last_event, traits }], next_before }
-- Identified persons only (end_users ⨝ product_events). first/last_seen_at
-- and event_count come from product_events. p_filter is a jsonb containment
-- test on end_users.traits (traits @> p_filter). Keyset pagination: pass the
-- returned next_before as p_before for the next page (null = no more).
create or replace function public.product_people(
  p_project_id uuid,
  p_filter     jsonb       default '{}'::jsonb,
  p_limit      integer     default 50,
  p_before     timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_filter jsonb   := case when jsonb_typeof(coalesce(p_filter, '{}'::jsonb)) = 'object'
                           then coalesce(p_filter, '{}'::jsonb)
                           else '{}'::jsonb end;
  v_result jsonb;
begin
  with pe as (
    select end_user_id,
           count(*)::bigint as event_count,
           min(ts)          as first_seen_at,
           max(ts)          as last_seen_at
      from public.product_events
     where project_id = p_project_id
       and end_user_id is not null
     group by end_user_id
  ),
  page as (
    select u.id            as end_user_id,
           u.external_user_id,
           u.display_name,
           pe.first_seen_at,
           pe.last_seen_at,
           pe.event_count,
           u.traits
      from pe
      join public.end_users u on u.id = pe.end_user_id
     where u.traits @> v_filter
       and (p_before is null or pe.last_seen_at < p_before)
     order by pe.last_seen_at desc, u.id
     limit v_limit
  ),
  people_rows as (
    select p.*,
           (select e.event_name
              from public.product_events e
             where e.project_id = p_project_id
               and e.end_user_id = p.end_user_id
             order by e.ts desc, e.id desc
             limit 1) as last_event
      from page p
  )
  select jsonb_build_object(
           'people', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'end_user_id',      end_user_id,
                      'external_user_id', external_user_id,
                      'display_name',     display_name,
                      'first_seen_at',    first_seen_at,
                      'last_seen_at',     last_seen_at,
                      'event_count',      event_count,
                      'last_event',       last_event,
                      'traits',           traits
                    ) order by last_seen_at desc, end_user_id)
               from people_rows
           ), '[]'::jsonb),
           'next_before', case when (select count(*) from people_rows) = v_limit
                               then (select min(last_seen_at) from people_rows)
                               else null end
         )
    into v_result;

  return v_result;
end;
$fn$;

comment on function public.product_people(uuid, jsonb, integer, timestamptz) is
  'People tab: identified end users with event activity, filtered by traits containment, newest activity first, keyset-paginated on last_seen_at. Service role only (GET /v1/admin/events/people).';

revoke all on function public.product_people(uuid, jsonb, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.product_people(uuid, jsonb, integer, timestamptz) to service_role;

-- ── 5. product_retention ────────────────────────────────────────────────────
-- { weeks, return_event, cohorts:[{ week_start:'YYYY-MM-DD', size, weeks:[pct_w0, pct_w1, …] }] }
--   cohort  = ISO week (UTC) of a person's FIRST event ever on the project;
--             only cohorts inside the last p_weeks weeks are returned
--   week N  = any event (or p_return_event) in cohort_week + N weeks
--   pct     = returning persons / cohort size × 100, one decimal;
--             null for weeks that have not started yet
--   weeks[] always has p_weeks entries (index = N).
create or replace function public.product_retention(
  p_project_id   uuid,
  p_weeks        integer default 8,
  p_return_event text    default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_weeks  integer     := greatest(1, least(coalesce(p_weeks, 8), 26));
  v_ret    text        := nullif(trim(coalesce(p_return_event, '')), '');
  v_end    timestamptz;
  v_start  timestamptz;
  v_result jsonb;
begin
  v_end   := date_trunc('week', now()) + interval '1 week';
  v_start := v_end - (v_weeks * interval '1 week');

  with first_seen as (
    select coalesce(end_user_id::text, anon_id) as person,
           date_trunc('week', min(ts))          as cohort_wk
      from public.product_events
     where project_id = p_project_id
       and coalesce(end_user_id::text, anon_id) is not null
     group by 1
    having date_trunc('week', min(ts)) >= v_start
  ),
  ret as (
    select distinct
           f.person,
           f.cohort_wk,
           floor(extract(epoch from (date_trunc('week', e.ts) - f.cohort_wk)) / 604800)::int as week_n
      from first_seen f
      join public.product_events e
        on e.project_id = p_project_id
       and coalesce(e.end_user_id::text, e.anon_id) = f.person
       and e.ts >= f.cohort_wk
       and e.ts <  v_end
       and (v_ret is null or e.event_name = v_ret)
  ),
  cohorts as (
    select cohort_wk, count(*)::bigint as size from first_seen group by cohort_wk
  ),
  cells as (
    select cohort_wk, week_n, count(*)::bigint as c from ret group by 1, 2
  ),
  grid as (
    select co.cohort_wk, co.size, n.week_n,
           case when co.cohort_wk + (n.week_n * interval '1 week') >= v_end then null
                else round(100.0 * coalesce(ce.c, 0) / co.size, 1) end as pct
      from cohorts co
      cross join generate_series(0, v_weeks - 1) as n(week_n)
      left join cells ce on ce.cohort_wk = co.cohort_wk and ce.week_n = n.week_n
  )
  select jsonb_build_object(
           'weeks',        v_weeks,
           'return_event', v_ret,
           'cohorts', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'week_start', to_char(g.cohort_wk, 'YYYY-MM-DD'),
                      'size',       g.size,
                      'weeks',      g.weeks
                    ) order by g.cohort_wk)
               from (
                 select cohort_wk, size, jsonb_agg(pct order by week_n) as weeks
                   from grid
                  group by cohort_wk, size
               ) g
           ), '[]'::jsonb)
         )
    into v_result;

  return v_result;
end;
$fn$;

comment on function public.product_retention(uuid, integer, text) is
  'Weekly retention cohorts (first-seen ISO week) over product_events; return = any event or p_return_event in week N. Service role only (GET /v1/admin/events/retention).';

revoke all on function public.product_retention(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.product_retention(uuid, integer, text) to service_role;

-- Flush PostgREST's schema + privilege caches (mirrors 20260921000002).
notify pgrst, 'reload schema';
notify pgrst, 'reload config';

-- ============================================================================
-- SEED-AND-ASSERT (run by hand after applying; nothing below executes).
--
-- Fixture: 3 persons, 2 sessions, 7 events, all in LAST ISO week (Tue + Wed)
-- so the funnel/paths windows and the retention cohort are deterministic.
-- Use a project with NO other product_events rows (retention and summary
-- read the whole project), e.g. a throwaway project you own.
--   A  anon 'fx_a', session 'fx_s1': landing_view(10:00, $utm_source=hn) → signup_click(10:01) → signup_completed(10:05)
--   B  anon 'fx_b', session 'fx_s2': landing_view(11:00, $utm_source=hn) → signup_click(11:02)
--   C  identified end_user (external 'fx_user_c'), no session, next day:
--      landing_view(09:00, no utm) → signup_completed(09:30)
--
-- \set pid '<project uuid>'          -- a project you own; :'org' = its organization_id
--
-- insert into public.end_users (organization_id, external_user_id, display_name, traits)
-- values (:'org', 'fx_user_c', 'Fixture C', '{"plan":"free"}'::jsonb)
-- on conflict (organization_id, external_user_id) do update set traits = excluded.traits;
--
-- with base as (select (date_trunc('week', now()) - interval '1 week' + interval '1 day') as d),
--      c as (select id from public.end_users where organization_id = :'org' and external_user_id = 'fx_user_c')
-- insert into public.product_events (project_id, event_name, ts, session_id, anon_id, end_user_id, surface, dedup_key, properties)
-- select :'pid', v.name, (select d from base) + v.off, v.sess, v.anon, case when v.ident then (select id from c) else null end, 'docs', 'fx:' || v.k, v.props
-- from (values
--   ('a1', 'landing_view',     interval '10:00', 'fx_s1', 'fx_a', false, '{"$utm_source":"hn"}'::jsonb),
--   ('a2', 'signup_click',     interval '10:01', 'fx_s1', 'fx_a', false, '{}'::jsonb),
--   ('a3', 'signup_completed', interval '10:05', 'fx_s1', 'fx_a', false, '{}'::jsonb),
--   ('b1', 'landing_view',     interval '11:00', 'fx_s2', 'fx_b', false, '{"$utm_source":"hn"}'::jsonb),
--   ('b2', 'signup_click',     interval '11:02', 'fx_s2', 'fx_b', false, '{}'::jsonb),
--   ('c1', 'landing_view',     interval '1 day 09:00', null, null, true, '{}'::jsonb),
--   ('c2', 'signup_completed', interval '1 day 09:30', null, null, true, '{}'::jsonb)
-- ) as v(k, name, off, sess, anon, ident, props)
-- on conflict (project_id, dedup_key) do nothing;
--
-- Expected (7 events; run with p_from = last week Monday, p_to = this week Monday):
--
-- select public.product_events_summary(:'pid', 30);
--   events_total 7 · persons 3 · identified 1 · anonymous 2
--   top_events: landing_view {count 3, persons 3}, signup_completed {2, 2}, signup_click {2, 2}
--
-- select public.product_funnel(:'pid', array['landing_view','signup_click','signup_completed'],
--                              date_trunc('week', now()) - interval '1 week', date_trunc('week', now()),
--                              interval '7 days', '$utm_source');
--   steps[0] landing_view      entered 3 converted 3 pct 100.0 median_secs 0.0
--   steps[1] signup_click      entered 3 converted 2 pct 66.7  median_secs 90.0   (A 60 s, B 120 s; C skipped it)
--   steps[2] signup_completed  entered 2 converted 1 pct 33.3  median_secs 300.0  (A only; C never did signup_click)
--   breakdown: [{value 'hn',     entered 2, steps [{2,2,100.0,0.0},{2,2,100.0,90.0},{2,1,50.0,300.0}]},
--               {value '(none)', entered 1, steps [{1,1,100.0,0.0},{1,0,0.0,null},{0,0,0.0,null}]}]
--   (steps shown as entered,converted,pct,median_secs)
--
-- select public.product_paths(:'pid', 'landing_view',
--                             date_trunc('week', now()) - interval '1 week', date_trunc('week', now()), 10);
--   total 3 · exits 0 · next: signup_click {2, 66.7}, signup_completed {1, 33.3}
--
-- select public.product_people(:'pid', '{"plan":"free"}', 50, null);
--   people: 1 row → external_user_id 'fx_user_c', event_count 2, last_event 'signup_completed', traits {"plan":"free"}
--   next_before null.  With p_filter '{"plan":"pro"}' → people [].
--
-- select public.product_retention(:'pid', 8, null);
--   cohorts: [{ week_start <last Monday>, size 3, weeks [100.0, 0.0, null, null, null, null, null, null] }]
--   (week 1 = the current week: started, no fixture events → 0.0; weeks 2+ have not started → null)
--
-- Cleanup:
-- delete from public.product_events where project_id = :'pid' and dedup_key like 'fx:%';
-- delete from public.end_users where organization_id = :'org' and external_user_id = 'fx_user_c';
-- ============================================================================
