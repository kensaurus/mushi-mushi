-- =============================================================================
-- 20260424020000_report_bulk_mutations_initplan_fix.sql
-- Wave T post-deploy hot-patch (2026-04-24).
--
-- The `report_bulk_mutations_log` migration shipped in 20260424000000 used the
-- raw form `using (admin_id = auth.uid())`. Supabase's performance linter
-- (auth_rls_initplan) flags this because PostgreSQL re-evaluates the function
-- once per row instead of caching the result across the query plan.
--
-- This migration is the idempotent in-place fix applied via Supabase MCP
-- against production on 2026-04-23. Re-running on a fresh database is safe
-- because the source migration (20260424000000) was also updated to use the
-- subquery form, so the policy is already correct on first install. Re-running
-- here is a no-op (drop-if-exists + same definition).
--
-- Pattern reference: migrations 20260418005100 (firecrawl), 20260420000200
-- (llm_cost_usd), 20260423040000 (wave_t) all use `(select auth.uid())`.
-- =============================================================================

drop policy if exists "Owner can read own bulk mutations" on report_bulk_mutations;
create policy "Owner can read own bulk mutations"
  on report_bulk_mutations
  for select
  using (admin_id = (select auth.uid()));
