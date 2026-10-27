/**
 * FILE: apps/admin/src/lib/countDefinitions.ts
 * PURPOSE: One unit and one definition per word for every "stuck / failed"
 *          count the console shows (pattern P4, console journeys 2026-10-27).
 *
 * On yen-yen, at one moment, the same idea read five ways: Home "Auto-fix
 * stopped on 39 reports", /pipeline "42 fixes: agent failed", /fixes
 * "Failed 39", /repo "17 branches failing CI", /pipeline CI stage "13 stuck".
 * Some counted reports, some fix attempts, some branches; one counted
 * dismissed and fixed reports (report f5575c9e). Every page that says one of
 * the words below takes its label from here, and its number from the server
 * module named next to it.
 *
 * GLOSSARY
 *
 *   Unit: a REPORT, unless a word says otherwise. A report is counted once,
 *   from its current state, however many attempts it had. Fixed, verified,
 *   resolved and dismissed reports are never stopped, failed or stuck.
 *
 *   Stopped — "Auto-fix stopped on N reports".
 *     Reports whose latest fix attempt failed, was skipped, or whose PR was
 *     closed unmerged or went red, among reports with an attempt in the last
 *     30 days. Server: _shared/fix-report-truth.ts (state `failed`), read by
 *     /v1/admin/fixes/stats `failed`, the dashboard's fixSummary.failed and
 *     the nav badge's fixesFailed. /fixes "Failed" is this number.
 *
 *   Agent failed — "N reports: the agent failed, no PR opened".
 *     The part of Stopped whose latest attempt ended without opening a PR,
 *     among attempts from the last 7 days. Server: _shared/pipeline-view.ts,
 *     group `agent_failed`. Always at most Stopped.
 *
 *   Failing CI — "N fix PRs failing CI". Unit: an open fix PULL REQUEST.
 *     Open, non-draft fix PRs whose own CI failed on the code. A test
 *     machine that stopped (ADR 0033) is not a failure: the code was not
 *     tested; drafts run no CI. Each report has at most one open fix PR, so
 *     this is also a count of reports. Server: _shared/repo-branch-counts.ts
 *     (/repo) and the pipeline's `ci_red` groups.
 *
 *   Stuck — /pipeline only: an item sitting in a group the pipeline marks
 *     stuck, at the stage it is stuck in. The CI stage's stuck count is
 *     Failing CI plus PRs whose test machine stopped, so it is never a
 *     second "failing CI" number.
 *
 *   In flight — reports with a fix attempt queued or running.
 *   PR open   — reports whose fix PR is open and not blocked.
 *   Fixed     — reports a merged fix closed in the window.
 */

import { pluralize } from './format'

/** Stopped: "Auto-fix stopped on 3 reports". */
export function stoppedTitle(reports: number): string {
  return `Auto-fix stopped on ${reports} ${pluralize(reports, 'report')}`
}

/** Failing CI: "2 fix PRs failing CI". */
export function failingCiTitle(prs: number): string {
  return `${prs} fix ${pluralize(prs, 'PR')} failing CI`
}

/** One-line definitions, for a hint beside the number. */
export const COUNT_HINTS = {
  stopped:
    'Reports whose latest auto-fix attempt failed, was skipped, or whose PR closed unmerged. Fixed and dismissed reports never count.',
  failingCi:
    'Open fix PRs whose own CI failed on the code. A stopped test machine and a draft PR do not count.',
  inFlight: 'Reports with a fix attempt queued or running.',
  prOpen: 'Reports whose fix PR is open and waiting for review or merge.',
  fixed: 'Reports a merged fix closed in the last 30 days.',
} as const
