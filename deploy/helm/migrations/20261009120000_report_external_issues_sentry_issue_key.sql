/*
FILE: 20261009120000_report_external_issues_sentry_issue_key.sql
PURPOSE: One Mushi report per Sentry issue, enforced by the database.

OVERVIEW:
_shared/sentry-ingest.ts dedups Sentry alerts by looking up the
report_external_issues row for (project, 'sentry', issue id) and, when there
is none, inserting a report and then its link. Two deliveries for the same
issue that arrive together both miss the lookup and both insert. The code
treated a unique violation on the link as "the other delivery won", but the
only unique key was (report_id, system, external_id), and report_id is a
fresh uuid per delivery, so that violation could never happen: both reports
were kept and classified. Once two links existed, findLinkedReport's
maybeSingle() errored on every later alert, so each one filed another report.

This index makes the second link insert fail with 23505, which sentry-ingest
now handles by deleting its own report and answering `deduped`.

Partial on system = 'sentry' on purpose: Linear dedup in classify-report
links several reports to one Linear issue, which must stay legal.

Production check before writing this (2026-10-09): 22 sentry links, 22
distinct (project_id, external_id) pairs, so the index builds as is.

Idempotent: safe to re-run.
*/

CREATE UNIQUE INDEX IF NOT EXISTS report_external_issues_sentry_issue_key
  ON public.report_external_issues (project_id, external_id)
  WHERE system = 'sentry';

COMMENT ON INDEX public.report_external_issues_sentry_issue_key IS
  'One sentry link per (project, Sentry issue). sentry-ingest.ts relies on the '
  '23505 from this index to detect a concurrent delivery and drop its duplicate report.';
