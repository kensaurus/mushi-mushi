-- Sentry issues that Sentry refuses to resolve by hand (2026-11-25).
--
-- Resolving issue 7863635600 after its report was fixed got HTTP 400
-- "Cannot manually resolve one or more issues.": its status belongs to a
-- Sentry detector (a metric alert or uptime issue), which resolves it when the
-- condition clears. resolved_at stayed null, so the 15-minute catch-up
-- (_shared/sentry-reconcile.ts) asked again on every rotation.
--
-- report_external_issues.sentry_managed_at: when Sentry refused the manual
-- resolve. Written by _shared/sentry-resolve-back.ts; the link stays open
-- (resolved_at and archived_at untouched) and resolve-back and the catch-up
-- skip it. Additive, nullable, no default: no row is rewritten. RLS unchanged
-- (service role only). The code reads without the column while this
-- migration is pending (42703 fallback).
--
-- Verify:
--   select column_name, data_type, is_nullable from information_schema.columns
--     where table_name = 'report_external_issues' and column_name = 'sentry_managed_at';  -- timestamp with time zone, YES

alter table public.report_external_issues
  add column if not exists sentry_managed_at timestamptz;

comment on column public.report_external_issues.sentry_managed_at is
  'When Sentry refused a manual resolve because its own detector closes the issue. The link stays open; resolve-back skips it.';
