-- ============================================================================
-- 20261007130000_ux_run_pull_request
--
-- Plan 021. ADDITIVE: apply BEFORE deploying the api function.
--
-- The pull request a finished UX run opened, so the console can show it and
-- merge it on the person's click (ADR 0017: nothing merges on its own).
--   pr_url, pr_number  the PR the studio opened from the run's branch
--   pr_state           'merged' once the console merged it (live state comes
--                      from GitHub; this only records what Mushi did)
--   pr_merged_at       when the console merged it
--
-- Verify after apply:
--   select column_name from information_schema.columns
--    where table_name = 'ux_runs' and column_name like 'pr_%' order by 1;
-- ============================================================================

alter table public.ux_runs
  add column if not exists pr_url text
    check (pr_url is null or pr_url ~ '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$'),
  add column if not exists pr_number integer
    check (pr_number is null or pr_number > 0),
  add column if not exists pr_state text
    check (pr_state is null or pr_state in ('merged')),
  add column if not exists pr_merged_at timestamptz;
