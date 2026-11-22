-- ============================================================================
-- 20261111090000_landing_referrer_spam
--
-- Referrer spam out of the cookieless landing count, and the leading
-- indicator sdk_seen_live on the daily GTM scorecard (GTM research note
-- 2026-11-11 play 0; ADR 0056 §6).
--
-- Why: from 2026-10-28 to 2026-11-11, 220 of 321 landing page views had the
-- referrer host www.aocr.org, a site with no link to Mushi Mushi; the same
-- host sent 444 of 531 GitHub repo views on 2026-11-05. It is a bot replaying
-- a referrer. Counted as visits it hides the ~100 real ones.
--
-- 1. is_spam_referrer_host(host): the denylist, a host or any subdomain of
--    one. Keep in step with SPAM_REFERRER_HOSTS in
--    functions/_shared/landing-visits.ts (landing-visits.test.ts compares the
--    two lists). The beacon route drops these views before this RPC runs.
-- 2. record_landing_page_view: refuses a spam host too (defence in depth for
--    an older api-ext deploy).
-- 3. gtm_daily_scorecard: page views leave spam hosts out, so rows stored
--    before the denylist existed stop counting (rows are kept, not deleted;
--    spam_views_excluded reports how many were left out). Adds
--    sdk_seen_live per day and per source: outside projects whose SDK first
--    checked in from a live site or a store app (sdk_seen_live, emitted once
--    per project by auth.ts recordSdkOrigin; localhost, private networks and
--    non-http schemes such as cli:// never reach it, _shared/sdk-origin.ts).
--    "Outside" is the company_funnel_weekly rule: owner and organization
--    owner not operators, not a synthetic account, organization not
--    complimentary. Signups now also leave synthetic accounts out, as the
--    weekly RPC does.
--
-- Service-role only. Not applied by this commit (owner review first).
-- ============================================================================

create or replace function public.is_spam_referrer_host(p_host text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select exists (
    select 1
    from unnest(array[
      'aocr.org'
    ]::text[]) as spam(host)
    where lower(coalesce(p_host, '')) = spam.host
       or lower(coalesce(p_host, '')) like '%.' || spam.host
  );
$fn$;

comment on function public.is_spam_referrer_host(text) is
  'Referrer-spam denylist for landing_page_views_daily (a host or any subdomain). Mirrors SPAM_REFERRER_HOSTS in functions/_shared/landing-visits.ts.';

revoke all on function public.is_spam_referrer_host(text) from public, anon, authenticated;
grant execute on function public.is_spam_referrer_host(text) to service_role;

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
  -- Referrer spam is never stored (the route drops it first; this repeats it).
  if public.is_spam_referrer_host(v_ref) then
    return;
  end if;

  if not exists (
       select 1 from public.landing_page_views_daily
        where day = v_day and path = v_path and src = v_src and referrer_host = v_ref)
     and (select count(*) from public.landing_page_views_daily where day = v_day) >= 2000 then
    v_path := '/(other)';
    v_src  := '';
    v_ref  := '';
  end if;

  insert into public.landing_page_views_daily (day, path, src, referrer_host, views)
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
