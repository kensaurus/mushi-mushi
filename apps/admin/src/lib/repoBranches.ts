/**
 * FILE: apps/admin/src/lib/repoBranches.ts
 * PURPOSE: The /repo branch filters and the linked-repo error copy
 *          (console QA group C, 2026-10-04).
 *
 * The server tags every branch row with its bucket
 * (`_shared/repo-branch-counts.ts`) and counts with the same rule, so each
 * filter here selects exactly the rows its header chip counts. "PR open"
 * includes open PRs whatever their CI says, like the chip.
 */

export type RepoServerBucket = 'merged' | 'failed' | 'ci_failed' | 'ci_passing' | 'open' | 'closed' | 'other'
export type RepoFilter = 'all' | 'open' | 'ci_passing' | 'ci_failed' | 'failed' | 'merged'

export const REPO_FILTERS: ReadonlyArray<{ id: RepoFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'PR open' },
  { id: 'ci_passing', label: 'CI passing' },
  { id: 'ci_failed', label: 'CI failing' },
  { id: 'merged', label: 'Merged' },
  { id: 'failed', label: 'Failed' },
]

export function resolveRepoFilter(value: string | null | undefined): RepoFilter {
  return REPO_FILTERS.some((f) => f.id === value) ? (value as RepoFilter) : 'all'
}

export interface RepoBranchLike {
  bucket?: RepoServerBucket | null
  status?: string | null
  pr_url?: string | null
  pr_state?: string | null
  merged_at?: string | null
  check_run_conclusion?: string | null
}

const FAILING = new Set(['failure', 'timed_out', 'startup_failure', 'action_required'])

/** The server's bucket, or the same rule for a row from an older server. */
function branchBucket(b: RepoBranchLike): RepoServerBucket {
  if (b.bucket) return b.bucket
  const status = (b.status ?? '').toLowerCase()
  if (b.merged_at || (b.pr_state ?? '').toLowerCase() === 'merged') return 'merged'
  if (!b.pr_url) return status === 'failed' ? 'failed' : 'other'
  if ((b.pr_state ?? '').toLowerCase() === 'closed') return 'closed'
  const c = (b.check_run_conclusion ?? '').toLowerCase()
  if (FAILING.has(c)) return 'ci_failed'
  if (c === 'success') return 'ci_passing'
  return 'open'
}

export function matchesRepoFilter(b: RepoBranchLike, filter: RepoFilter): boolean {
  if (filter === 'all') return true
  const bucket = branchBucket(b)
  if (filter === 'open') return bucket === 'open' || bucket === 'ci_passing' || bucket === 'ci_failed'
  return bucket === filter
}

export function countRepoFilters(rows: readonly RepoBranchLike[]): Record<RepoFilter, number> {
  const counts: Record<RepoFilter, number> = { all: 0, open: 0, ci_passing: 0, ci_failed: 0, failed: 0, merged: 0 }
  for (const row of rows) {
    for (const f of REPO_FILTERS) if (matchesRepoFilter(row, f.id)) counts[f.id] += 1
  }
  return counts
}

/** A save / remove failure on the linked-repos card, in plain English. */
export function repoActionErrorMessage(
  action: 'add' | 'save' | 'remove',
  error: { code?: string; message?: string } | null | undefined,
): string {
  const verb = action === 'add' ? 'add this repo' : action === 'save' ? 'save this repo' : 'remove this repo'
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  if (error?.code === 'FORBIDDEN') return `You can't ${verb}: ask a project owner or admin.`
  if (message && error?.code !== 'DB_ERROR' && error?.code !== 'ERROR') return message
  return `Couldn't ${verb}. Try again in a moment.`
}
