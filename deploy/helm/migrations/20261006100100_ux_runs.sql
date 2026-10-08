-- ============================================================================
-- 20261006100100_ux_runs
--
-- Plan 021 Phase 2. ADDITIVE: apply BEFORE deploying the api function.
--
-- Console mirror of `mushi-ux` runs (ADR 0020). The loop runs on the
-- person's machine; with `--sync` it upserts the run, its screens and each
-- attempt here, and uploads small screenshots to the private ux-captures
-- bucket, so the console can show the same burndown live.
--
--   ux_runs        one row per local run (unique per project + local_run_id)
--   ux_surfaces    one row per screen in the run (status, scores, review)
--   ux_iterations  one row per agent attempt on a screen
--
-- Only paths are stored (never full URLs or query tokens); the loop never
-- sends page HTML, console text or the agent's output beyond a short tail.
--
-- Members read through RLS; writes go through the api (service role).
-- ux_runs and ux_surfaces join the realtime publication for live updates.
--
-- Verify after apply:
--   select relname, relrowsecurity from pg_class
--    where relname in ('ux_runs','ux_surfaces','ux_iterations');     -- all t
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename like 'ux_%';  -- ux_runs, ux_surfaces
--   select id, public from storage.buckets where id = 'ux-captures';  -- public = f
-- ============================================================================

create table if not exists public.ux_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  local_run_id text not null check (local_run_id ~ '^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$'),
  mode text not null default 'local' check (mode in ('local', 'cloud')),
  status text not null default 'running' check (status in ('running', 'done', 'failed', 'stopped')),
  agent text not null check (char_length(agent) between 1 and 40),
  model text check (model is null or char_length(model) <= 120),
  judge_model text check (judge_model is null or char_length(judge_model) <= 120),
  branch text check (branch is null or char_length(branch) <= 200),
  base_sha text check (base_sha is null or base_sha ~ '^[0-9a-f]{7,40}$'),
  counts jsonb not null default '{}'::jsonb,
  cli_version text check (cli_version is null or char_length(cli_version) <= 40),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (project_id, local_run_id)
);
create index if not exists ux_runs_project_started on public.ux_runs (project_id, started_at desc);

create table if not exists public.ux_surfaces (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ux_runs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  surface_key text not null check (char_length(surface_key) between 1 and 120),
  kind text not null check (kind in ('page', 'tab', 'dialog', 'menu')),
  path text not null check (path like '/%' and char_length(path) <= 500),
  label text not null check (char_length(label) <= 300),
  status text not null check (status in (
    'pending', 'baseline', 'iterating', 'accepted', 'reverted', 'skipped', 'regressed', 'blocked'
  )),
  note text check (note is null or char_length(note) <= 1000),
  penalty_before integer,
  penalty_after integer,
  probe_before jsonb,
  probe_after jsonb,
  judge jsonb,
  -- Storage object paths in ux-captures: <project_id>/<run_id>/<surface_key>/<name>.png
  thumb_before text,
  thumb_after text,
  thumb_diff text,
  report_id uuid references public.reports(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (run_id, surface_key)
);
create index if not exists ux_surfaces_project on public.ux_surfaces (project_id);

create table if not exists public.ux_iterations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ux_runs(id) on delete cascade,
  surface_id uuid not null references public.ux_surfaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  n integer not null check (n between 1 and 20),
  agent text not null check (char_length(agent) between 1 and 40),
  model text check (model is null or char_length(model) <= 120),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  outcome text not null check (outcome in ('accepted', 'rejected', 'agent_failed', 'capture_failed', 'no_change')),
  reason text check (reason is null or char_length(reason) <= 1000),
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$'),
  pixel_diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (surface_id, n)
);
create index if not exists ux_iterations_run on public.ux_iterations (run_id);

alter table public.ux_runs enable row level security;
alter table public.ux_surfaces enable row level security;
alter table public.ux_iterations enable row level security;

drop policy if exists ux_runs_member_select on public.ux_runs;
create policy ux_runs_member_select on public.ux_runs
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists ux_runs_service_write on public.ux_runs;
create policy ux_runs_service_write on public.ux_runs
  for all to service_role using (true) with check (true);

drop policy if exists ux_surfaces_member_select on public.ux_surfaces;
create policy ux_surfaces_member_select on public.ux_surfaces
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists ux_surfaces_service_write on public.ux_surfaces;
create policy ux_surfaces_service_write on public.ux_surfaces
  for all to service_role using (true) with check (true);

drop policy if exists ux_iterations_member_select on public.ux_iterations;
create policy ux_iterations_member_select on public.ux_iterations
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists ux_iterations_service_write on public.ux_iterations;
create policy ux_iterations_service_write on public.ux_iterations
  for all to service_role using (true) with check (true);

revoke all on table public.ux_runs, public.ux_surfaces, public.ux_iterations from anon;
grant select on table public.ux_runs, public.ux_surfaces, public.ux_iterations to authenticated;

-- Live console updates (same idempotent pattern as 20261004170000).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ux_runs', 'ux_surfaces'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Private bucket, service-role only like 'screenshots' and 'voice-intake'.
-- The CLI uploads through short-lived signed upload URLs minted by the api;
-- the console reads through signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ux-captures', 'ux-captures', false, 5242880, array['image/png', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

alter table public.project_settings
  add column if not exists ux_capture_retention_days integer not null default 30
    check (ux_capture_retention_days between 1 and 365);
comment on column public.project_settings.ux_capture_retention_days is
  'Plan 021: days to keep UX-loop screenshots in the ux-captures bucket; the retention sweep deletes older runs'' captures.';

comment on table public.ux_runs is 'Plan 021 / ADR 0020: console mirror of a local mushi-ux run.';
comment on table public.ux_surfaces is 'Plan 021: one screen of a mushi-ux run (status, problem scores, review, screenshot paths).';
comment on table public.ux_iterations is 'Plan 021: one agent attempt on one screen of a mushi-ux run.';

notify pgrst, 'reload schema';
