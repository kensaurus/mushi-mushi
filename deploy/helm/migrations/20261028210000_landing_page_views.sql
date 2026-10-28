-- ============================================================================
-- 20261028210000_landing_page_views
--
-- Cookieless landing page-view count and the daily GTM scorecard (November
-- GTM plan, docs/plan-gtm-november-2026.md §6.1).
--
-- Why: company_funnel_weekly counts visits from docs_page_view /
-- landing_view, which the docs site sends only after a visitor accepts the
-- consent bar. On 2026-10-28 that was 0 measured landing visits. This count
-- needs no consent because it keeps nothing personal and writes nothing to
-- the visitor's device:
--
-- 1. landing_page_views_daily: one row per (UTC day, site path, `?src=` tag,
--    referrer host) with a count. No IP, id, user agent, fingerprint or full
--    URL. The beacon route (api/routes/landing-visits.ts, POST
--    /v1/public/page-view) rate-limits per visitor on a bucket `api` derives
--    from a sha-256 of the IP salted with a secret and the UTC day
--    (api/page-view-forward.ts); the IP itself is
--    never forwarded or stored. RLS on with no policy (deny-all) and every
--    privilege revoked from anon and authenticated: only the service role
--    reads or writes it, through the RPCs below.
--    A day accepts at most 2,000 distinct rows; past that a new combination
--    lands in '/(other)', so junk paths cannot grow the table without bound.
--
-- 2. record_landing_page_view(path, src, referrer_host): the upsert.
--
-- 3. gtm_daily_scorecard(days): per UTC day, page views, builder signups
--    (operators and tester-only accounts out, as in company_funnel_weekly)
--    and activated organizations (product_events 'activated' in the self
--    project, emitted by classify-report, _shared/activation.ts), plus the
--    same three by source. A page view's source is its `?src=` tag; a
--    signup's or activation's is the owner's signup_source, else the first
--    touch the docs site forwarded (signup_first_touch), the precedence
--    company_funnel_weekly uses, so by_src rows line up. No source = 'unknown'.
--
-- Service-role only. Not applied by this commit (owner review first).
-- ============================================================================

create table if not exists public.landing_page_views_daily (
  day            date    not null,
  path           text    not null check (char_length(path) between 1 and 96),
  src            text    not null default '' check (char_length(src) <= 64),
  referrer_host  text    not null default '' check (char_length(referrer_host) <= 253),
  views          integer not null default 0 check (views >= 0),
  primary key (day, path, src, referrer_host)
);

comment on table public.landing_page_views_daily is
  'Cookieless docs/landing page views per UTC day, path, ?src= tag and referrer host. No personal data (GTM plan 2026-11 §6.1). Service role only.';

alter table public.landing_page_views_daily enable row level security;
revoke all on table public.landing_page_views_daily from public, anon, authenticated;
grant select, insert, update on table public.landing_page_views_daily to service_role;

create or replace function public.record_landing_page_view(
  p_path text,
  p_src text,
  p_referrer_host text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_day  date := (now() at time zone 'utc')::date;
  v_path text := p_path;
  v_src  text := coalesce(p_src, '');
  v_ref  text := coalesce(p_referrer_host, '');
begin
  if not exists (
       select 1 from public.landing_page_views_daily
        where day = v_day and path = v_path and src = v_src and referrer_host = v_ref)
     and (select count(*) from public.landing_page_views_daily where day = v_day) >= 2000 then
    v_path := '/(other)';
    v_src  := '';
    v_ref  := '';
  end if;

  insert into public.landing_page_views_daily as t (day, path, src, referrer_host, views)
  values (v_day, v_path, v_src, v_ref, 1)
  on conflict (day, path, src, referrer_host)
  do update set views = public.landing_page_views_daily.views + 1;
end;
$fn$;

revoke all on function public.record_landing_page_view(text, text, text) from public, anon, authenticated;
grant execute on function public.record_landing_page_view(text, text, text) to service_role;

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
    -- Builder signups, as company_funnel_weekly's people CTE: operators and
    -- tester-only accounts out; source = signup_source, else first touch.
    people as (
      select u.id,
             (u.created_at at time zone 'utc')::date as day,
             src.source
      from auth.users u
      cross join lateral (
        select coalesce(
                 nullif(nullif(u.raw_user_meta_data ->> 'signup_source', ''), 'unknown'),
                 nullif(u.raw_user_meta_data ->> 'signup_first_touch', ''),
                 'unknown') as source
      ) src
      where not exists (select 1 from op where op.user_id = u.id)
        and not (
          (   exists (select 1 from public.mushi_testers t where t.auth_user_id = u.id)
           or coalesce(u.raw_user_meta_data ->> 'signup_track', '') = 'tester')
          and not exists (select 1 from public.projects owned where owned.owner_id = u.id)
        )
    ),
    views as (
      select v.day,
             coalesce(nullif(v.src, ''), 'unknown') as source,
             sum(v.views)::bigint as n
      from public.landing_page_views_daily v
      where v.day >= v_start
      group by 1, 2
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
    ),
    sources as (
      select source from views
      union select source from signups
      union select source from activated
    )
    select jsonb_build_object(
      'window_start', v_start,
      'self_project_configured', v_self is not null,
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'day', d.day,
                 'page_views', coalesce((select sum(n) from views v where v.day = d.day), 0),
                 'signups',    (select count(*) from signups s where s.day = d.day),
                 'activated',  (select count(*) from activated a where a.day = d.day))
               order by d.day)
        from d), '[]'::jsonb),
      'by_src', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'src', s.source,
                 'page_views', coalesce((select sum(n) from views v where v.source = s.source), 0),
                 'signups',    (select count(*) from signups x where x.source = s.source),
                 'activated',  (select count(*) from activated a where a.source = s.source))
               order by s.source)
        from sources s), '[]'::jsonb)
    )
  );
end;
$fn$;

revoke all on function public.gtm_daily_scorecard(integer) from public, anon, authenticated;
grant execute on function public.gtm_daily_scorecard(integer) to service_role;
