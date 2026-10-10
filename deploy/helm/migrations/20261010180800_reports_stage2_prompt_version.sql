-- ============================================================================
-- 20261010180800_reports_stage2_prompt_version
--
-- classify-report writes reports.stage2_prompt_version and judge-batch,
-- api/routes/judge.ts and the classify dedup clone read it, but no migration
-- ever added it: 20260416100000_phase1_intelligence_layer added only
-- stage1_prompt_version, and the hosted project got stage2 out of band.
-- A database built from these migrations (self-host, Helm, a fresh branch)
-- failed judge-batch's select, so it skipped every project.
--
-- No-op where the column already exists (production has it as text, with no
-- index).
-- ============================================================================

alter table public.reports
  add column if not exists stage2_prompt_version text;
