-- Sentry webhook reports were stored with the column default source 'widget',
-- so the console showed a Sentry error as a report someone filed from the
-- in-app widget (22 of 61 reports on 2026-10-09). Ingest now writes
-- 'sentry' (_shared/sentry-ingest.ts, api/routes/public.ts); this moves the
-- existing rows. 'sentry' is already allowed by reports_source_check.
update public.reports
   set source = 'sentry'
 where custom_metadata->>'source' = 'sentry_webhook'
   and source = 'widget';
