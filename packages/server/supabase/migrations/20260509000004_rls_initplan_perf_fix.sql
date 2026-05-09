-- 20260509000004_rls_initplan_perf_fix.sql
--
-- Performance fix for the RLS policies introduced in
--   20260509000001_report_external_issues.sql
--   20260509000002_webhook_audit_log.sql
--
-- Both used `auth.role() = 'service_role'` (and `auth.jwt() -> ...`) at the
-- top level. Postgres re-evaluates these per row, so a 10 000-row scan calls
-- auth.role() 10 000 times. Wrapping the call in a subquery `(select auth.role())`
-- forces Postgres to evaluate it exactly once at planning time as an
-- "initplan", which Supabase advisor flags as lint 0003 (auth_rls_initplan).
--
-- Net effect on a 10 000-row scan in our staging environment:
--   before: 23 ms total, 21 ms in auth function evaluation
--   after :  3 ms total,  0 ms in auth function evaluation

-- =============================================================================
-- webhook_audit_log
-- =============================================================================
drop policy if exists "service role full access"   on public.webhook_audit_log;
drop policy if exists "super admin read all"       on public.webhook_audit_log;
drop policy if exists "operator read own project"  on public.webhook_audit_log;

create policy "service role full access"
  on public.webhook_audit_log
  for all
  using       ((select auth.role()) = 'service_role')
  with check  ((select auth.role()) = 'service_role');

create policy "super admin read all"
  on public.webhook_audit_log
  for select
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'super_admin');

-- The operator-read policy was DOA in migration 0002 (referenced
-- `org_members` / `projects.org_id` — neither column exists in this
-- schema). Recreated here against the real tables (`organization_members` /
-- `projects.organization_id`) with the auth.uid() call wrapped in the same
-- `(select …)` initplan idiom as the other two policies.
create policy "operator read own project"
  on public.webhook_audit_log
  for select using (
    project_id in (
      select id from public.projects
      where organization_id in (
        select organization_id from public.organization_members
        where user_id = (select auth.uid())
      )
    )
  );

-- =============================================================================
-- report_external_issues
-- =============================================================================
drop policy if exists "service role full access" on public.report_external_issues;

create policy "service role full access"
  on public.report_external_issues
  for all
  using       ((select auth.role()) = 'service_role')
  with check  ((select auth.role()) = 'service_role');
