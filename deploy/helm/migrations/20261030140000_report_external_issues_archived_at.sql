-- A Sentry issue archived from Mushi (report closed as not-a-bug, or a person
-- pressed "Archive in Sentry") had no record on the link: resolved_at stays
-- unset because the issue is archived, not fixed. The report page then could
-- not tell it from an issue still open in Sentry and kept offering the action.
-- archived_at is stamped after Sentry answered the archive, and cleared with
-- resolved_at when the report reopens (sentry-resolve-back.ts).
alter table public.report_external_issues
  add column if not exists archived_at timestamptz;

comment on column public.report_external_issues.archived_at is
  'When Mushi archived the linked Sentry issue (until escalating). Null while open or resolved.';
