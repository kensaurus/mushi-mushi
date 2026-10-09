-- ============================================================================
-- 20261006100400_ux_run_live_step
--
-- Plan 021. ADDITIVE: apply BEFORE deploying the api function.
--
-- What the agent is doing right now, for the console's UX runs page:
--   ux_runs.current_progress = {
--     steps:       how many steps the agent took (reads, edits, commands, messages),
--     last_step:   the latest one, one line ("[edit] app/page.tsx"),
--     files:       files changed in the worktree so far (at most 20),
--     started_at:  when this attempt started,
--     timeout_ms:  the attempt's time box
--   }
-- A running mushi-ux checks in every 30 s, which also moves updated_at, so
-- the console can say a run has gone quiet.
--
--   ux_iterations.steps = what the agent did in that attempt, one readable
--     step per line ("[read] app/page.tsx", "[edit] app/globals.css"), the
--     last 2000 characters.
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_name = 'ux_runs' and column_name = 'current_progress';
-- ============================================================================

alter table public.ux_runs
  add column if not exists current_progress jsonb
    check (
      current_progress is null
      or (jsonb_typeof(current_progress) = 'object' and pg_column_size(current_progress) <= 16384)
    );

alter table public.ux_iterations
  add column if not exists steps text check (steps is null or char_length(steps) <= 2000);

comment on column public.ux_iterations.steps is
  'Plan 021: the agent''s steps in this attempt, one per line, last 2000 characters.';

comment on column public.ux_runs.current_progress is
  'Plan 021: live step of the attempt in flight (steps, last_step, files, started_at, timeout_ms); null between attempts.';
