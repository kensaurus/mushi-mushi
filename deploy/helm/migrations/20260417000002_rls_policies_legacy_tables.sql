-- =============================================================================
-- RLS policies for tables flagged by Supabase advisor as
-- "rls_enabled_no_policy". All 17 of these had RLS enabled at table-creation
-- time but never received policies, which means they were unreadable by both
-- the anon and authenticated roles (silently empty queries) while still being
-- writable by service_role. This migration closes the gap by following the
-- existing convention used by `reports` and `project_settings`:
--
--   * Project-owner SELECT/UPDATE/INSERT/DELETE via projects.owner_id check
--   * service_role keeps unrestricted access for backend functions
--
-- Two tables (`fix_verifications`, `report_embeddings`) lack a direct
-- project_id column and must look up ownership via their parent `reports` row.
--
-- Performance-conscious: every policy uses the (SELECT auth.uid()) subquery
-- form so Postgres caches the result via initPlan instead of re-evaluating
-- per row (per Supabase RLS performance guide).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: tables with a direct project_id FK get the same project-owner pattern
-- -----------------------------------------------------------------------------
do $$
declare
  tbl text;
  tables text[] := array[
    'audit_logs', 'bug_ontology', 'classification_evaluations',
    'enterprise_sso_configs', 'fine_tuning_jobs', 'fix_attempts',
    'graph_edges', 'graph_nodes', 'processing_queue',
    'project_codebase_files', 'project_integrations', 'project_plugins',
    'prompt_versions', 'report_groups', 'reporter_reputation',
    'synthetic_reports'
  ];
begin
  foreach tbl in array tables loop
    execute format('drop policy if exists "owner_select_%I" on %I', tbl, tbl);
    execute format($f$
      create policy "owner_select_%I" on %I
        for select to authenticated
        using (project_id in (
          select id from projects where owner_id = (select auth.uid())
        ))
    $f$, tbl, tbl);

    execute format('drop policy if exists "service_role_all_%I" on %I', tbl, tbl);
    execute format($f$
      create policy "service_role_all_%I" on %I
        for all to service_role
        using (true) with check (true)
    $f$, tbl, tbl);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- prompt_versions special case: rows with project_id IS NULL act as global
-- defaults (per the prompt-ab.ts module). All authenticated users may read
-- those defaults; project rows still scoped to owner.
-- -----------------------------------------------------------------------------
drop policy if exists "owner_select_prompt_versions" on prompt_versions;
create policy "owner_select_prompt_versions" on prompt_versions
  for select to authenticated
  using (
    project_id is null
    or project_id in (select id from projects where owner_id = (select auth.uid()))
  );

-- -----------------------------------------------------------------------------
-- fix_verifications: no project_id column. Resolve via report_id -> reports.
-- -----------------------------------------------------------------------------
drop policy if exists "owner_select_fix_verifications" on fix_verifications;
create policy "owner_select_fix_verifications" on fix_verifications
  for select to authenticated
  using (
    report_id in (
      select r.id from reports r
      join projects p on p.id = r.project_id
      where p.owner_id = (select auth.uid())
    )
  );

drop policy if exists "service_role_all_fix_verifications" on fix_verifications;
create policy "service_role_all_fix_verifications" on fix_verifications
  for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- report_embeddings: also no project_id column. Same JOIN pattern.
-- -----------------------------------------------------------------------------
drop policy if exists "owner_select_report_embeddings" on report_embeddings;
create policy "owner_select_report_embeddings" on report_embeddings
  for select to authenticated
  using (
    report_id in (
      select r.id from reports r
      join projects p on p.id = r.project_id
      where p.owner_id = (select auth.uid())
    )
  );

drop policy if exists "service_role_all_report_embeddings" on report_embeddings;
create policy "service_role_all_report_embeddings" on report_embeddings
  for all to service_role using (true) with check (true);
