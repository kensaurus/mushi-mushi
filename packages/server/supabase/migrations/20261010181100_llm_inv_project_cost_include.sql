-- ============================================================================
-- 20261010181100_llm_inv_project_cost_include
--
-- 20260420000200 added idx_llm_inv_project_cost "so the /v1/admin/billing
-- per-project monthly $ rollup stays index-only", but the index held only
-- (project_id, created_at): reading cost_usd still went to the heap for every
-- row. The rollups (api/routes/billing.ts, _shared/billing-usage-counts.ts)
-- select project_id + cost_usd where cost_usd is not null, so INCLUDE
-- (cost_usd) lets them run as index-only scans.
--
-- Rebuilt in place, not CONCURRENTLY (a migration runs in a transaction):
-- llm_invocations is ~2.3k rows live, so the write lock is momentary.
-- ============================================================================

drop index if exists public.idx_llm_inv_project_cost;

create index idx_llm_inv_project_cost
  on public.llm_invocations (project_id, created_at desc)
  include (cost_usd)
  where cost_usd is not null;
