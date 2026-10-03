/**
 * FILE: apps/admin/src/components/repo/RepoIndexStatus.tsx
 * PURPOSE: The "Indexed X ago" line on the Repo page and the repos card,
 *          read from the last sweep of either kind (index coverage, gap 16a).
 *
 * `last_indexed_at` moves only when a sweep covered every eligible file, so
 * a repo held at its plan's file limit never sets it. Reading it alone hid
 * the chip for every capped repo, and showed a frozen date for rows that
 * were partial before the coverage columns existed. The later of
 * `last_indexed_at` and `index_swept_at` is the last sweep; the coverage
 * state says whether that sweep covered the repo.
 */

import { RelativeTime } from '../ui'
import { SignalChip } from '../report-detail/ReportSurface'
import { indexCoverageText, lastIndexSweepAt } from '../projects/project-models'

export interface RepoIndexFields {
  last_indexed_at: string | null
  index_swept_at?: string | null
  index_coverage_state?: string | null
  index_files_indexed?: number | null
  index_files_eligible?: number | null
}

export interface RepoIndexView {
  label: 'Indexed' | 'Partly indexed' | 'Index stalled'
  tone: 'brand' | 'warn'
  /** The last sweep, complete or partial. */
  at: string
  /** "300 of 4,714 files", when the sweep measured it. */
  coverage: string | null
}

/** Null until a sweep has run. Rows from before the coverage columns read as indexed. */
export function repoIndexView(repo: RepoIndexFields): RepoIndexView | null {
  const at = lastIndexSweepAt({ last_indexed_at: repo.last_indexed_at, index_swept_at: repo.index_swept_at ?? null })
  if (!at) return null
  const coverage = indexCoverageText({
    index_files_indexed: repo.index_files_indexed ?? null,
    index_files_eligible: repo.index_files_eligible ?? null,
  })
  switch (repo.index_coverage_state) {
    case 'filling':
    case 'capped':
      return { label: 'Partly indexed', tone: 'warn', at, coverage }
    case 'stalled':
      return { label: 'Index stalled', tone: 'warn', at, coverage }
    default:
      return { label: 'Indexed', tone: 'brand', at, coverage }
  }
}

function hint(view: RepoIndexView, state: string | null | undefined): string {
  if (state === 'capped') return "The plan's file limit is reached; diagnoses only see the indexed files."
  if (state === 'filling') return 'The hourly sweep keeps adding files until the repo or the plan limit is covered.'
  if (state === 'stalled') return 'The last sweep added no file. See the index error on the Codebase indexing card.'
  return view.coverage ? `${view.coverage} indexed.` : 'Last sweep of the codebase index.'
}

/** As a chip (Repo page header) or a muted line (repos card). */
export function RepoIndexStatus({ repo, variant }: { repo: RepoIndexFields; variant: 'chip' | 'line' }) {
  const view = repoIndexView(repo)
  if (!view) return null
  const partial = view.label !== 'Indexed'
  const body = (
    <>
      {view.label}
      {partial && view.coverage ? `: ${view.coverage}` : ''}
      {partial ? ', swept ' : ' '}
      <RelativeTime value={view.at} />
    </>
  )
  const title = hint(view, repo.index_coverage_state)
  if (variant === 'chip') {
    return (
      <SignalChip tone={view.tone} title={title}>
        <span data-testid="repo-index-status">{body}</span>
      </SignalChip>
    )
  }
  return (
    <p className={`text-2xs ${partial ? 'text-warn' : 'text-fg-faint'}`} title={title} data-testid="repo-index-status">
      {body}
    </p>
  )
}
