-- =============================================================================
-- 20261127130000_ux_timeline
--
-- Plan 025 P1 + P8, ADR 0072. ADDITIVE and idempotent: apply BEFORE deploying
-- the api-ext and retention-sweep functions.
--
--   ux_baselines                    one pinned screenshot of one screen at one
--                                   viewport for one release (or version label).
--                                   The file is a COPY under
--                                   <project>/baselines/… in ux-captures, so the
--                                   30-day capture sweep never deletes it. The
--                                   retention sweep keeps the newest
--                                   project_settings.ux_baseline_keep_releases
--                                   versions per (screen, viewport); a row with
--                                   pinned = true is kept forever.
--   project_settings.ux_baseline_keep_releases
--                                   default 24 (owner decision 2026-11-27)
--   project_settings.ux_baseline_auto_pin
--                                   opt-in, default off: pin on release publish
--   ux_surfaces.capture_hash        P8: what a scorecard page was scored on
--                                   (text facts + prompt version + viewport +
--                                   a perceptual hash of the shot).
--                                   The same hash in the same app reuses the
--                                   stored verdict instead of a model call.
--   ux_surfaces.judge_cached        true when the verdict was reused
--   ux_surfaces.cost_usd            what scoring this page cost (0 when cached)
--   ux_runs.cost_usd / ux_runs.cost what the run's model calls cost, and
--                                   { judged, cached, unpriced } counts
--
-- Members read through RLS; writes go through the api (service role), like
-- ux_runs (20261006100100).
--
-- Verify after apply:
--   select relrowsecurity from pg_class where relname = 'ux_baselines';          -- t
--   select has_table_privilege('anon', 'public.ux_baselines', 'select');          -- f
--   select column_name from information_schema.columns
--    where table_name = 'ux_surfaces' and column_name in ('capture_hash','judge_cached','cost_usd');  -- 3 rows
-- =============================================================================

create table if not exists public.ux_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- One screen across runs: a page is keyed by its path, a tab/dialog/menu by
  -- the loop's own surface key (_shared/ux-timeline.ts timelineSurfaceKey).
  surface_key text not null check (surface_key ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  path text not null check (path like '/%' and char_length(path) <= 500),
  label text not null check (char_length(label) <= 300),
  viewport text not null check (viewport in ('desktop', 'mobile')),
  -- The release the screen shipped in; the version label stays when the release row goes.
  release_id uuid references public.releases(id) on delete set null,
  version text not null check (char_length(version) between 1 and 80),
  run_id uuid references public.ux_runs(id) on delete set null,
  capture_path text not null check (capture_path like '%/baselines/%' and char_length(capture_path) <= 500),
  capture_hash text check (capture_hash is null or capture_hash ~ '^[0-9a-f]{16,64}$'),
  score smallint check (score is null or score between 1 and 10),
  -- The loop's problem score (lower is better) when the screen came from a UX loop run.
  penalty integer check (penalty is null or penalty >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, surface_key, viewport, version)
);

create index if not exists ux_baselines_project_surface
  on public.ux_baselines (project_id, surface_key, viewport, created_at desc);
create index if not exists ux_baselines_project_created
  on public.ux_baselines (project_id, created_at desc);
create index if not exists ux_baselines_release
  on public.ux_baselines (release_id) where release_id is not null;
create index if not exists ux_baselines_run
  on public.ux_baselines (run_id) where run_id is not null;

alter table public.ux_baselines enable row level security;

drop policy if exists ux_baselines_member_select on public.ux_baselines;
create policy ux_baselines_member_select on public.ux_baselines
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists ux_baselines_service_write on public.ux_baselines;
create policy ux_baselines_service_write on public.ux_baselines
  for all to service_role using (true) with check (true);

revoke all on table public.ux_baselines from anon;
grant select on table public.ux_baselines to authenticated;

comment on table public.ux_baselines is
  'Plan 025 P1 / ADR 0072: one pinned screenshot per screen, viewport and release, for the console Timeline. The file is a copy under <project>/baselines/ in ux-captures.';
comment on column public.ux_baselines.pinned is
  'ADR 0072: keep forever. Unpinned rows past the newest project_settings.ux_baseline_keep_releases versions of their screen are deleted by the retention sweep, file first.';

alter table public.project_settings
  add column if not exists ux_baseline_keep_releases integer not null default 24
    check (ux_baseline_keep_releases between 1 and 500);
alter table public.project_settings
  add column if not exists ux_baseline_auto_pin boolean not null default false;
comment on column public.project_settings.ux_baseline_auto_pin is
  'ADR 0072: opt-in (default off). When a release is published, pin each screen''s current screenshot to it, under the same limits as Pin current screens.';

comment on column public.project_settings.ux_baseline_keep_releases is
  'ADR 0072: how many releases of each screen the Timeline keeps (pinned baselines are kept beyond it). Owner decision 2026-11-27: 24.';

-- ── P8: score a page only when what it shows changed ──────────────────────────
alter table public.ux_surfaces
  add column if not exists capture_hash text
    check (capture_hash is null or capture_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists judge_cached boolean not null default false,
  add column if not exists cost_usd numeric(12, 6)
    check (cost_usd is null or cost_usd >= 0);

comment on column public.ux_surfaces.capture_hash is
  'ADR 0072: sha256 of what a scorecard page was scored on. The newest scored row with the same hash in the same app is reused instead of a model call.';
comment on column public.ux_surfaces.judge_cached is
  'ADR 0072: the score was reused from an earlier run with the same capture_hash; no model call was made.';
comment on column public.ux_surfaces.cost_usd is
  'ADR 0072: what scoring this page cost in USD (0 when reused, NULL when the call could not be priced).';

create index if not exists ux_surfaces_project_capture_hash
  on public.ux_surfaces (project_id, capture_hash, updated_at desc)
  where capture_hash is not null and score is not null;

alter table public.ux_runs
  add column if not exists cost_usd numeric(12, 6)
    check (cost_usd is null or cost_usd >= 0),
  add column if not exists cost jsonb
    check (cost is null or (jsonb_typeof(cost) = 'object' and pg_column_size(cost) <= 2048));

comment on column public.ux_runs.cost_usd is
  'ADR 0072: what the run''s model calls cost in USD (scorecard pages, the loop''s review). NULL = not recorded.';
comment on column public.ux_runs.cost is
  'ADR 0072: { judged, cached, unpriced, input_tokens, output_tokens }: how many verdicts were model calls, how many were reused.';

notify pgrst, 'reload schema';
