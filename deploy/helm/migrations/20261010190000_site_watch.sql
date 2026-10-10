-- ============================================================================
-- 20261010190000_site_watch
--
-- Live-site watch (ADR 0024). Firecrawl crawls an app's live site on a
-- schedule (a Firecrawl monitor, billed to the project's own key); Mushi
-- polls each monitor's checks and files a broken page (a 5xx, a linked page
-- that 404s, a page that fails to load, or one the monitor's judge calls
-- broken) as a report with source 'site_watch', before a user hits it.
--
-- ADDITIVE: new tables, one appended reports.source value, one cron job.
-- Apply BEFORE deploying the api and site-watch-poll functions.
-- ============================================================================

-- One watch per project.
create table if not exists public.site_watches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  base_url text not null,
  page_limit integer not null default 25 check (page_limit between 1 and 100),
  schedule_cron text not null default '30 1 * * *',
  firecrawl_monitor_id text,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_check_id text,
  last_checked_at timestamptz,
  last_summary jsonb,
  last_error text,
  estimated_credits_per_month integer,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.site_watches is
  'Live-site watch per project (ADR 0024): the Firecrawl monitor that crawls the app''s live site, and the last check Mushi read.';

-- A page the watch found broken; one row per page, reopened when it breaks again.
create table if not exists public.site_watch_pages (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.site_watches(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  url text not null,
  problem text not null check (problem in ('http_error', 'load_error', 'judged_broken')),
  status_code integer,
  detail text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  report_id uuid references public.reports(id) on delete set null,
  unique (watch_id, url)
);

create index if not exists idx_site_watch_pages_open
  on public.site_watch_pages (project_id, last_seen_at desc)
  where resolved_at is null;

alter table public.site_watches enable row level security;
alter table public.site_watch_pages enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_watches' and policyname = 'site_watches_member_select') then
    create policy site_watches_member_select on public.site_watches
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_watches' and policyname = 'site_watches_service_write') then
    create policy site_watches_service_write on public.site_watches
      for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_watch_pages' and policyname = 'site_watch_pages_member_select') then
    create policy site_watch_pages_member_select on public.site_watch_pages
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_watch_pages' and policyname = 'site_watch_pages_service_write') then
    create policy site_watch_pages_service_write on public.site_watch_pages
      for all to service_role using (true) with check (true);
  end if;
end $$;

revoke all on table public.site_watches, public.site_watch_pages from anon;
grant select on table public.site_watches, public.site_watch_pages to authenticated;

-- reports.source: append 'site_watch' to the live list (same as 20261007140000).
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['site_watch'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass
     AND conname = 'reports_source_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reports_source_check not found; refusing to guess the allowed sources';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of reports_source_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.reports DROP CONSTRAINT reports_source_check';
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

COMMENT ON COLUMN public.reports.source IS
  'Which inbox created the report: widget (SDK banner), sdk (programmatic), sentry (webhook), slack, voice (phone voice intake), api, linear, store_review (an App Store or Google Play review), ux_loop (a screen the mushi-ux loop flagged), library_modernizer (a dependency upgrade proposal), site_watch (a live page the site watch found broken).';

-- Hourly at :14 (free on every staggered edge lattice; see
-- 20260912007000): read the checks the Firecrawl monitors finished.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-site-watch-poll schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-site-watch-poll';

  PERFORM cron.schedule(
    'mushi-site-watch-poll',
    '14 * * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/site-watch-poll',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := '{}'::jsonb
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;
