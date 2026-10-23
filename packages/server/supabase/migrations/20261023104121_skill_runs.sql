-- Skill runs (ADR 0042): one skill from the synced catalog applied to one
-- scope of one app, round after round. Each round is a report
-- (source 'skill_run') that spend-down sends to the app's own Cursor key; its
-- PR gets the Opus review and, with auto_merge, the merge queue (ADR 0041).

create table if not exists public.skill_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  skill_slug text not null check (skill_slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  scope text not null check (char_length(scope) between 3 and 500),
  rounds_max integer not null default 3 check (rounds_max between 1 and 5),
  round integer not null default 0 check (round >= 0),
  -- Hand an Opus-approved round PR to the merge queue (its own gates still apply).
  auto_merge boolean not null default true,
  status text not null default 'active' check (status in ('active', 'done', 'stopped')),
  stop_reason text,
  current_report_id uuid references public.reports(id) on delete set null,
  -- [{ round, reportId, outcome, prUrl }]
  history jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_until timestamptz
);

create index if not exists idx_skill_runs_active on public.skill_runs (project_id) where status = 'active';
create index if not exists idx_skill_runs_report on public.skill_runs (current_report_id);

alter table public.skill_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'skill_runs' and policyname = 'skill_runs_member_select') then
    create policy skill_runs_member_select on public.skill_runs
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'skill_runs' and policyname = 'skill_runs_service_write') then
    create policy skill_runs_service_write on public.skill_runs
      for all to service_role using (true) with check (true);
  end if;
end $$;

revoke all on table public.skill_runs from anon;
revoke insert, update, delete, truncate on table public.skill_runs from authenticated;
grant select on table public.skill_runs to authenticated;

-- reports.source: append 'skill_run' to the live list.
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['skill_run'];
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

-- Every 10 minutes (:07 to :57).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-skill-runs schedule';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-skill-runs';
  PERFORM cron.schedule(
    'mushi-skill-runs',
    '7-57/10 * * * *',
    $cmd$select mushi.cron_http_post('skill-runs', jsonb_build_object('trigger', 'cron'));$cmd$
  );
END $$;
