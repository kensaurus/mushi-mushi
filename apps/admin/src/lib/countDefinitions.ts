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
 *   from its current state, however many attempts it had.
 *
 *   Stopped — "Auto-fix stopped on N reports".
 *     Reports whose latest fix attempt failed, was skipped, or whose PR was
 *     closed unmerged or went red, among reports with an attempt in the last
 *     30 days. Fixed, verified, resolved and dismissed reports never count.
 *     Server: _shared/fix-report-truth.ts (state `failed`). Read by
 *     /v1/admin/fixes/stats `failed` (/fixes "Stopped", the active app), the
 *     dashboard's fixSummary.failed (Home) and /v1/admin/fixes/summary
 *     `failed` (the sidebar badge, via workspace-nav-meta; it covers every
 *     app in scope, so it can be larger than one app's number).
 *
 *   Agent failed — "N reports: the agent failed, no PR opened".
 *     Reports whose newest attempt in the last 7 days ended without a PR,
 *     with no fix in flight. Fixed, verified, resolved and dismissed reports
 *     never count. Server: _shared/pipeline-view.ts, groups `agent_failed`,
 *     `agent_failed_person` (the agent says a person must decide) and
 *     `agent_failed_nothing` (nothing to change in the code); together they
 *     are the one count (AGENT_FAILED_GROUP_IDS).
 *     It is a part of Stopped, over a shorter window.
 *
 *   Failing CI — "N fix PRs failing CI". Unit: an open fix PULL REQUEST, as
 *     the /repo list shows them (a report with two open PRs counts twice).
 *     Open, non-draft fix PRs whose check summary (check_run_conclusion)
 *     failed on the code. A test machine that stopped (ADR 0033) and a draft
 *     do not count. The report's status is not read: an open PR on a
 *     dismissed report still needs closing. Server:
 *     _shared/repo-branch-counts.ts (/repo tiles, banner and list).
 *
 *   Stuck — /pipeline only: an item in a group the pipeline marks stuck,
 *     counted at the one stage it sits in. A red-CI PR that is unreviewed or
 *     that Opus held sits at the Reviewed stage, not at CI, and the CI stage
 *     reads job-level results (ci_jobs) where /repo reads the PR's check
 *     summary. So the CI stage's stuck count is not Failing CI and is
 *     usually smaller; say "stuck at CI", never "failing CI", for it.
 *
 *   Ready to merge — Unit: an open fix PULL REQUEST. Not a draft, its
 *     latest Opus review says "merge" about its current commit, and its own
 *     CI passed on the code (a stopped test machine is not a pass). The same
 *     rule (readyToMerge) picks /fixes "Ready to merge" and /repo "Mergeable
 *     now". /pipeline's "approved and green, not queued to merge" is the part
 *     of it not in the merge queue yet.
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

/** The /pipeline groups that make up "Agent failed" (one count, split by why). */
export const AGENT_FAILED_GROUP_IDS: ReadonlySet<string> = new Set(['agent_failed', 'agent_failed_person', 'agent_failed_nothing'])

/** The fields "Ready to merge" reads; a fix attempt (GET /v1/admin/fixes) has them all. */
export interface ReadyToMergeSignals {
  pr_url?: string | null
  pr_state?: string | null
  merged_at?: string | null
  commit_sha?: string | null
  check_run_conclusion?: string | null
  ci_infra?: { infra: boolean } | null
  review_verdict?: string | null
  /** The commit the latest Opus review is about; unknown on an older server. */
  review_head_sha?: string | null
}

/** Ready to merge (see the glossary). A review about an older commit is stale, never "merge". */
export function readyToMerge(fix: ReadyToMergeSignals): boolean {
  if (!fix.pr_url || fix.merged_at) return false
  if ((fix.pr_state ?? 'open') !== 'open') return false
  if (fix.review_verdict !== 'merge') return false
  if (fix.review_head_sha && fix.commit_sha && fix.review_head_sha !== fix.commit_sha) return false
  if (fix.ci_infra?.infra) return false
  return (fix.check_run_conclusion ?? '').toLowerCase() === 'success'
}

/** One-line definitions, for a hint beside the number. */
export const COUNT_HINTS = {
  readyToMerge: 'Open fix PRs whose Opus review says merge about their latest commit and whose CI passed.',
  stuck: 'Items waiting longer than their step should take, or that need a person. Each counts once, at the step it sits in.',
  stopped:
    'Reports whose latest auto-fix attempt failed, was skipped, or whose PR closed unmerged. Fixed and dismissed reports never count.',
  failingCi:
    'Open fix PRs whose own CI failed on the code. A stopped test machine and a draft PR do not count.',
  inFlight: 'Reports with a fix attempt queued or running.',
  prOpen: 'Reports whose fix PR is open and waiting for review or merge.',
  fixed: 'Reports a merged fix closed in the last 30 days.',
} as const
