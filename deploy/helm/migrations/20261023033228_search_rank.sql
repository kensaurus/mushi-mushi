-- Search rank check: where each app ranks in web search for the words its
-- users would type, read weekly through the app's Firecrawl key (/v2/search,
-- 2 credits per 10 results). A visibility number for the owner on /credits;
-- it files no reports.

create table if not exists public.search_rank_keywords (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  query text not null check (char_length(query) between 2 and 200),
  country text not null default 'US' check (country ~ '^[A-Z]{2}$'),
  -- Host, or host plus path prefix, that counts as the app (kensaur.us/glot-it).
  target text not null,
  last_rank integer,
  last_top jsonb,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (project_id, query, country)
);

create table if not exists public.search_rank_history (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.search_rank_keywords(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  checked_at timestamptz not null default now(),
  rank integer
);

create index if not exists idx_search_rank_due on public.search_rank_keywords (last_checked_at nulls first);
create index if not exists idx_search_rank_history_kw on public.search_rank_history (keyword_id, checked_at desc);

alter table public.search_rank_keywords enable row level security;
alter table public.search_rank_history enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'search_rank_keywords' and policyname = 'search_rank_keywords_member_select') then
    create policy search_rank_keywords_member_select on public.search_rank_keywords
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'search_rank_keywords' and policyname = 'search_rank_keywords_service_write') then
    create policy search_rank_keywords_service_write on public.search_rank_keywords
      for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'search_rank_history' and policyname = 'search_rank_history_member_select') then
    create policy search_rank_history_member_select on public.search_rank_history
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'search_rank_history' and policyname = 'search_rank_history_service_write') then
    create policy search_rank_history_service_write on public.search_rank_history
      for all to service_role using (true) with check (true);
  end if;
end $$;

grant select on table public.search_rank_keywords, public.search_rank_history to authenticated;
revoke all on table public.search_rank_keywords, public.search_rank_history from anon;

-- Daily at 04:47: check the keywords not checked in the last 7 days.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-search-rank schedule';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-search-rank';
  PERFORM cron.schedule(
    'mushi-search-rank',
    '47 4 * * *',
    $cmd$select mushi.cron_http_post('search-rank', jsonb_build_object('trigger', 'cron'));$cmd$
  );
END $$;
