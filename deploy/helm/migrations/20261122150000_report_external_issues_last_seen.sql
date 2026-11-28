-- Sentry's own "last seen" for a linked issue (2026-11-22).
--
-- report_external_issues.last_seen_at: when Sentry last saw the issue, as
-- Sentry reports it (the issue's `lastSeen`, else the alert event's time).
-- Written by _shared/sentry-ingest.ts recordSentryLastSeen whenever Mushi
-- hears about an issue it already linked (a repeat alert, the auto-import
-- poll, a manual import, a reopen) and by the Sentry pull
-- (_shared/sentry-reconcile.ts pullSentryResolves) when it reads the issue.
-- It only moves forward. Before this, a repeat alert on an open report was
-- deduplicated without any write, so the report page could only say when
-- Mushi Mushi last received an event, not when Sentry last saw one.
--
-- NULL = not recorded yet (links made before this column, or no Sentry
-- contact since). Additive, nullable, no default: no row is rewritten.
-- RLS unchanged (service role only, 20260509000001_report_external_issues.sql).
-- The report detail route reads it with a fallback select while this
-- migration is pending, and the writers only log when the column is missing,
-- so apply it before or after deploying `api` and `sentry-seer-poll`.
--
-- Verify:
--   select column_name, data_type, is_nullable from information_schema.columns
--     where table_name = 'report_external_issues' and column_name = 'last_seen_at';  -- timestamp with time zone, YES

alter table public.report_external_issues
  add column if not exists last_seen_at timestamptz;

comment on column public.report_external_issues.last_seen_at is
  'When Sentry last saw the linked issue (its lastSeen, else the alert event time). Only moves forward. NULL = not recorded yet.';
