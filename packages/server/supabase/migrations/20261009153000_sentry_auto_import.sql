-- New Sentry issues reached Mushi only through an alert-rule webhook the
-- operator builds by hand in Sentry. Four of five projects with a Sentry
-- token had none, so nothing new arrived after the 2026-10-03 manual import
-- while 12 issues piled up in Sentry (2026-10-09).
--
-- With this on, the 15-minute Sentry poll (sentry-seer-poll) imports new
-- unresolved issues through the same idempotent path as the console's
-- "Import existing Sentry issues". Off by default: each imported issue is
-- triaged like any report, and that spend is the operator's call.
alter table public.project_settings
  add column if not exists sentry_auto_import boolean not null default false,
  add column if not exists sentry_auto_import_last_at timestamptz;

comment on column public.project_settings.sentry_auto_import is
  'Poll Sentry every 15 min and import new unresolved issues (no webhook needed).';
comment on column public.project_settings.sentry_auto_import_last_at is
  'When the Sentry auto-import last ran for this project.';
