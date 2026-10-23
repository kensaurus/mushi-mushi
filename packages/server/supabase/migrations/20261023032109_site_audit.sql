-- Site audit (ADR 0040): a scheduled rendered crawl of an app's live site,
-- checked by deterministic rules (dead links and images, missing metadata,
-- another locale's text, links that drop the locale, images without alt).
-- Each rule with findings files one report (source 'site_audit'). Off by
-- default; billed to the project's Firecrawl key, like the site watch.

create table if not exists public.site_audits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  enabled boolean not null default false,
  base_url text not null,
  page_limit integer not null default 200 check (page_limit between 1 and 500),
  cadence_days integer not null default 7 check (cadence_days between 1 and 30),
  next_run_at timestamptz,
  -- A Firecrawl batch scrape in flight, read on a later tick.
  batch_id text,
  batch_started_at timestamptz,
  claimed_until timestamptz,
  last_run_at timestamptz,
  last_summary jsonb,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.site_audits is
  'Site audit per project (ADR 0040): schedule, the Firecrawl batch in flight and the last run''s summary.';

create table if not exists public.site_audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.site_audits(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  rule text not null check (rule in (
    'broken_internal_link', 'broken_external_link', 'broken_image', 'page_metadata_missing',
    'locale_metadata_mismatch', 'locale_text_leak', 'locale_link_drop', 'image_alt_missing'
  )),
  pages integer not null default 0,
  evidence jsonb not null default '[]'::jsonb,
  report_id uuid references public.reports(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (audit_id, rule)
);

create index if not exists idx_site_audits_due
  on public.site_audits (next_run_at)
  where enabled;

alter table public.site_audits enable row level security;
alter table public.site_audit_findings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_audits' and policyname = 'site_audits_member_select') then
    create policy site_audits_member_select on public.site_audits
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_audits' and policyname = 'site_audits_service_write') then
    create policy site_audits_service_write on public.site_audits
      for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_audit_findings' and policyname = 'site_audit_findings_member_select') then
    create policy site_audit_findings_member_select on public.site_audit_findings
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_audit_findings' and policyname = 'site_audit_findings_service_write') then
    create policy site_audit_findings_service_write on public.site_audit_findings
      for all to service_role using (true) with check (true);
  end if;
end $$;

grant select on table public.site_audits, public.site_audit_findings to authenticated;

-- reports.source: append 'site_audit' to the live list (same as 20261010190000).
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['site_audit'];
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
  'Which inbox created the report: widget (SDK banner), sdk (programmatic), sentry (webhook), slack, voice (phone voice intake), api, linear, store_review (an App Store or Google Play review), ux_loop (a screen the mushi-ux loop flagged), library_modernizer (a dependency upgrade proposal), security_advisory (a known hole in a dependency), site_watch (a live page the site watch found broken), site_audit (a rule the site audit found failing on the live site).';

-- Hourly at :29: start a due audit's batch scrape, or read one that finished.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-site-audit schedule';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-site-audit';
  PERFORM cron.schedule(
    'mushi-site-audit',
    '29 * * * *',
    $cmd$select mushi.cron_http_post('site-audit', jsonb_build_object('trigger', 'cron'));$cmd$
  );
END $$;
