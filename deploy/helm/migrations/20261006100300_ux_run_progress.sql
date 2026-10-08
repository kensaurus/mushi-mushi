-- ============================================================================
-- 20261006100300_ux_run_progress
--
-- Plan 021. ADDITIVE: apply BEFORE deploying the api function.
--
-- Live progress and every attempt's screenshots in the console's UX runs
-- page, the same as the local studio shows:
--
--   ux_runs        phase, phase_detail, the screen and attempt the agent is on,
--                  the skill applied, the ref the run branched from, the error
--   ux_surfaces    thumbs: { "before-mobile": path, "after-desktop": path, … }
--   ux_iterations  thumbs: { "after-mobile": path, "diff-desktop": path, … }
--
-- thumbs values are object paths in the private ux-captures bucket, under
-- <project_id>/<run_id>/ like the existing thumb_* columns (kept as is).
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_name = 'ux_runs' and column_name in ('phase','current_surface','skill');
-- ============================================================================

alter table public.ux_runs
  add column if not exists phase text
    check (phase is null or phase in ('starting', 'worktree', 'install', 'dev-server', 'mapping', 'working', 'reviewing', 'done', 'failed')),
  add column if not exists phase_detail text check (phase_detail is null or char_length(phase_detail) <= 300),
  add column if not exists current_surface text check (current_surface is null or char_length(current_surface) <= 120),
  add column if not exists current_attempt integer check (current_attempt is null or current_attempt between 1 and 20),
  add column if not exists skill text check (skill is null or char_length(skill) <= 120),
  add column if not exists base_ref text check (base_ref is null or char_length(base_ref) <= 200),
  add column if not exists error text check (error is null or char_length(error) <= 1000);

alter table public.ux_surfaces
  add column if not exists thumbs jsonb not null default '{}'::jsonb;

alter table public.ux_iterations
  add column if not exists thumbs jsonb not null default '{}'::jsonb,
  add column if not exists penalty_after integer;

comment on column public.ux_runs.phase is 'Plan 021: where a mushi-ux run is (mapping, working, done, …), for the live console view.';
comment on column public.ux_surfaces.thumbs is 'Plan 021: screenshot paths in ux-captures by slot (before-mobile, after-desktop, …).';
comment on column public.ux_iterations.thumbs is 'Plan 021: this attempt''s screenshot paths in ux-captures by slot (after-mobile, diff-desktop, …).';

notify pgrst, 'reload schema';
