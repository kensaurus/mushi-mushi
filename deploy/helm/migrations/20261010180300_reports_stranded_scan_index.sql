-- ============================================================================
-- 20261010180300_reports_stranded_scan_index
--
-- recover_stranded_pipeline() runs every 5 minutes and scans reports across
-- all projects: WHERE status IN ('new','queued') AND created_at < now() - 5
-- min ORDER BY created_at LIMIT 25. 20260421000000_audit_remediation gave it
-- a partial (status, created_at) index; 20260520600000_reports_status_extend
-- replaced that name with a (project_id, status, created_at) index, which
-- cannot serve a query with no project_id, so the cron fell back to a
-- sequential scan. This restores a partial index for that probe under its
-- own name; the project-scoped index stays for the console filters.
-- ============================================================================

create index if not exists reports_stranded_created_at_idx
  on public.reports (created_at)
  where status in ('new', 'queued');
