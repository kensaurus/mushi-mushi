-- ============================================================================
-- 20261006100500_ux_plan_steps
--
-- Plan 021. ADDITIVE: apply BEFORE deploying the api function.
--
-- Small-steps mode in the console's UX runs page:
--   ux_surfaces.plan   = the screen's plan, [{ text, status, attempt }],
--                        status pending | done | skipped | failed, at most 8
--   ux_iterations.step = the plan step an attempt made
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where (table_name = 'ux_surfaces' and column_name = 'plan')
--       or (table_name = 'ux_iterations' and column_name = 'step');
-- ============================================================================

alter table public.ux_surfaces
  add column if not exists plan jsonb
    check (
      plan is null
      or (jsonb_typeof(plan) = 'array' and jsonb_array_length(plan) <= 8 and pg_column_size(plan) <= 16384)
    );

alter table public.ux_iterations
  add column if not exists step text check (step is null or char_length(step) <= 300);

comment on column public.ux_surfaces.plan is
  'Plan 021 small steps: [{text, status, attempt}] for the screen, status pending|done|skipped|failed.';
comment on column public.ux_iterations.step is
  'Plan 021 small steps: the plan step this attempt made.';
