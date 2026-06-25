/**
 * FILE: apps/admin/src/lib/statTooltips/repo.ts
 * PURPOSE: Human-readable StatCard tooltips for the Repo snapshot strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { RepoStats } from '../../components/repo/RepoStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function branchesTooltip(stats: RepoStats): MetricTooltipData {
  const takeaway =
    stats.totalBranches > 0
      ? `${stats.totalBranches} fix attempt${stats.totalBranches === 1 ? '' : 's'} opened a PR — track merge and CI status below.`
      : stats.hasRepo
        ? 'GitHub repo connected but no fix PRs yet — dispatch a fix from Fixes to populate this strip.'
        : 'Connect a GitHub repo under Integrations before autofix can open pull requests.'

  return metricTip(
    'Fix attempts that successfully opened a pull request (recent window, up to 200 rows).',
    'Counts fix_attempts rows with a non-null pr_url for the active project, ordered by created_at descending.',
    takeaway,
    stats.failedToOpen > 0
      ? { tone: 'warn', text: `${stats.failedToOpen} fix${stats.failedToOpen === 1 ? '' : 'es'} failed before opening a PR.` }
      : undefined,
  )
}

export function branchesDetail(stats: RepoStats, compact?: boolean): string {
  if (compact) {
    return stats.failedToOpen > 0 ? `${stats.failedToOpen} stuck` : 'total with PRs'
  }
  return 'fix attempts with PRs'
}

export function prOpenTooltip(stats: RepoStats): MetricTooltipData {
  const takeaway =
    stats.prOpen > 0
      ? `${stats.prOpen} completed fix${stats.prOpen === 1 ? '' : 'es'} left an open PR awaiting review or merge.`
      : 'No open PRs from completed fixes — merge or close to advance the Act stage.'

  return metricTip(
    'Pull requests from completed fix attempts that are still open on GitHub.',
    'Counts fix_attempts where status is completed and pr_url is set for the active project.',
    takeaway,
    stats.prOpen > 0
      ? { tone: 'info', text: `${stats.prOpen} PR${stats.prOpen === 1 ? '' : 's'} awaiting review — check Repo → Branches.` }
      : undefined,
  )
}

export function prOpenDetail(): string {
  return 'awaiting review'
}

export function ciPassingTooltip(stats: RepoStats): MetricTooltipData {
  const takeaway =
    stats.ciPassing > 0
      ? `${stats.ciPassing} fix PR${stats.ciPassing === 1 ? '' : 's'} with a successful GitHub check-run conclusion.`
      : 'No passing CI checks on fix PRs yet — checks appear after GitHub Actions runs on the branch.'

  return metricTip(
    'Fix-attempt PRs whose latest GitHub check-run concluded success.',
    'Counts fix_attempts where check_run_conclusion equals success among recent attempts with pr_url.',
    takeaway,
  )
}

export function ciPassingDetail(): string {
  return 'check-run success'
}

export function ciFailedTooltip(stats: RepoStats): MetricTooltipData {
  const takeaway =
    stats.ciFailed > 0
      ? `${stats.ciFailed} fix PR${stats.ciFailed === 1 ? '' : 's'} failed CI — inspect logs before merging or retrying.`
      : 'No failing CI on fix PRs — green or neutral conclusions only.'

  return metricTip(
    'Fix-attempt PRs whose GitHub check-run failed or errored (excludes neutral/skipped).',
    'Counts fix_attempts where check_run_conclusion is set and not success or neutral.',
    takeaway,
    stats.ciFailed > 0
      ? { tone: 'warn', text: `${stats.ciFailed} failing CI run${stats.ciFailed === 1 ? '' : 's'} — fix before merge.` }
      : undefined,
  )
}

export function ciFailedDetail(): string {
  return 'needs attention'
}

export function mergedTooltip(stats: RepoStats): MetricTooltipData {
  const takeaway =
    stats.merged > 0
      ? `${stats.merged} fix PR${stats.merged === 1 ? '' : 's'} merged to the default branch.`
      : 'No merged fix PRs tracked yet — merge completed PRs to land fixes on main.'

  return metricTip(
    'Fix pull requests merged into the default branch.',
    'Counts fix_attempts marked merged for the active project (merged_at or equivalent status when populated).',
    takeaway,
  )
}

export function mergedDetail(): string {
  return 'landed on main'
}

export function stuckTooltip(stats: RepoStats): MetricTooltipData {
  const takeaway =
    stats.failedToOpen > 0
      ? `${stats.failedToOpen} fix attempt${stats.failedToOpen === 1 ? '' : 's'} failed before opening a PR — check GitHub app permissions and repo config.`
      : 'No stuck fixes — every recent attempt either opened a PR or is still running.'

  return metricTip(
    'Fix attempts that failed before a pull request could be opened.',
    'Counts fix_attempts where status equals failed among recent rows with pr_url lookup for the active project.',
    takeaway,
    stats.failedToOpen > 0
      ? { tone: 'warn', text: 'Failed to open PR — verify GitHub integration and fix-worker logs.' }
      : undefined,
  )
}

export function stuckDetail(): string {
  return 'failed to open PR'
}
