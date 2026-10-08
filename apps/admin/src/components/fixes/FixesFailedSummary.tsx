/**
 * "Common causes" chips above the failed list: one chip per cause of the
 * still-unfixed reports (their latest attempt), each narrowing the list to
 * that cause. The status banner already carries the headline and count.
 */

import { Btn } from '../ui'
import { failureCause, fixCauseLabel, needsAttention } from '../../lib/fixReportTruth'
import type { FixAttempt } from './types'

interface Props {
  fixes: FixAttempt[]
  /** Narrow the failed list to one cause ('' = every cause). */
  onReviewCategory?: (category: string) => void
}

export function FixesFailedSummary({ fixes, onReviewCategory }: Props) {
  const failed = fixes.filter(needsAttention)
  if (failed.length === 0) return null

  const buckets = new Map<string, number>()
  for (const f of failed) {
    const cat = failureCause(f)
    buckets.set(cat, (buckets.get(cat) ?? 0) + 1)
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      <span className="text-2xs text-fg-muted">Common causes:</span>
      {sorted.map(([category, count]) => (
        <button
          key={category}
          type="button"
          onClick={() => onReviewCategory?.(category)}
          title={`Show the ${count} failed ${count === 1 ? 'fix' : 'fixes'} with this cause`}
          className="inline-flex items-center gap-1 rounded-full border border-danger/25 bg-surface-raised/80 px-2 py-0.5 text-2xs hover:border-danger/40 motion-safe:transition-opacity"
        >
          <span className="font-mono text-danger">{count}</span>
          <span className="text-fg-secondary">{fixCauseLabel(category)}</span>
        </button>
      ))}
      {onReviewCategory ? (
        <Btn size="sm" variant="ghost" className="!text-2xs !py-0.5" onClick={() => onReviewCategory('')}>
          Show all failed
        </Btn>
      ) : null}
    </div>
  )
}
