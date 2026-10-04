/**
 * FILE: packages/server/supabase/functions/_shared/repo-branch-counts.ts
 * PURPOSE: One rule for the /repo page's numbers and filters.
 *
 * /repo computed "PRs open", "CI failing", "Merged" and "Stuck" three ways:
 * `/repo/stats` counted merged PRs as open, any non-success conclusion as
 * failing and hard-coded Branches and Merged to 0; `/repo/overview` used
 * other rules; the page's filter used a third (console QA #98, #243). Both
 * routes now read the same window of attempts and run it through this file,
 * and each branch row carries its filter bucket, so a tile, a header chip and
 * the list it opens always agree.
 *
 * No imports: vitest loads this file directly.
 */

/** Values the `project_repos.role` CHECK allows (migrations/20260418001900). */
export const PROJECT_REPO_ROLES = [
  'frontend',
  'backend',
  'monorepo',
  'mobile',
  'ai',
  'infra',
  'docs',
  'other',
] as const
export type ProjectRepoRole = (typeof PROJECT_REPO_ROLES)[number]

export function isProjectRepoRole(value: unknown): value is ProjectRepoRole {
  return typeof value === 'string' && (PROJECT_REPO_ROLES as readonly string[]).includes(value)
}

/** How many recent fix attempts the /repo numbers cover. */
export const REPO_BRANCH_WINDOW = 200

/** Check-run conclusions that need the developer before merging. */
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'action_required'])

export interface RepoBranchRowLike {
  branch?: string | null
  status?: string | null
  pr_url?: string | null
  pr_state?: string | null
  merged_at?: string | null
  check_run_conclusion?: string | null
}

/** Mutually exclusive filter bucket for one fix attempt on /repo. */
export type RepoBranchBucket = 'merged' | 'failed' | 'ci_failed' | 'ci_passing' | 'open' | 'closed' | 'other'

export function isRepoBranchMerged(row: RepoBranchRowLike): boolean {
  return Boolean(row.merged_at) || (row.pr_state ?? '').toLowerCase() === 'merged'
}

export function classifyRepoBranch(row: RepoBranchRowLike): RepoBranchBucket {
  const status = (row.status ?? '').toLowerCase()
  if (isRepoBranchMerged(row)) return 'merged'
  if (!row.pr_url) return status === 'failed' ? 'failed' : 'other'
  if ((row.pr_state ?? '').toLowerCase() === 'closed') return 'closed'
  // A PR exists and is open: what matters now is its CI, whatever the
  // attempt's own status says.
  const conclusion = (row.check_run_conclusion ?? '').toLowerCase()
  if (FAILING_CONCLUSIONS.has(conclusion)) return 'ci_failed'
  if (conclusion === 'success') return 'ci_passing'
  return 'open'
}

export interface RepoBranchCounts {
  /** Attempts in the window. */
  total: number
  /** Distinct fix branches pushed. */
  totalBranches: number
  /** Open PRs, whatever their CI says (includes ciPassing and ciFailed). */
  prOpen: number
  ciPassing: number
  ciFailed: number
  merged: number
  /** Attempts that failed before opening a PR. */
  failedToOpen: number
}

export function countRepoBranches(rows: readonly RepoBranchRowLike[]): RepoBranchCounts {
  const branches = new Set<string>()
  const counts: RepoBranchCounts = {
    total: rows.length,
    totalBranches: 0,
    prOpen: 0,
    ciPassing: 0,
    ciFailed: 0,
    merged: 0,
    failedToOpen: 0,
  }
  for (const row of rows) {
    if (row.branch) branches.add(row.branch)
    switch (classifyRepoBranch(row)) {
      case 'merged':
        counts.merged++
        break
      case 'failed':
        counts.failedToOpen++
        break
      case 'ci_failed':
        counts.prOpen++
        counts.ciFailed++
        break
      case 'ci_passing':
        counts.prOpen++
        counts.ciPassing++
        break
      case 'open':
        counts.prOpen++
        break
      default:
        break
    }
  }
  counts.totalBranches = branches.size
  return counts
}
