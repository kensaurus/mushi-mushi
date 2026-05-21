/**
 * Groups failed fix attempts by failure_category so operators can spot
 * dominant failure modes without scrolling the full table.
 */

import { Badge, Btn } from '../ui'
import type { FixAttempt } from './types'

interface Props {
  fixes: FixAttempt[]
  onReviewCategory?: (category: string) => void
  /** Quick mode: count only, no category chips. */
  compact?: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  claude_workflow_missing: 'Workflow missing',
  claude_api_error: 'Claude API',
  cursor_api_error: 'Cursor API',
  sandbox_timeout: 'Sandbox timeout',
  scope_blocked: 'Scope blocked',
  unknown: 'Unknown',
}

export function FixesFailedSummary({ fixes, onReviewCategory, compact = false }: Props) {
  const failed = fixes.filter((f) => f.status === 'failed')
  if (failed.length === 0) return null

  const buckets = new Map<string, number>()
  for (const f of failed) {
    const cat = f.failure_category ?? 'unknown'
    buckets.set(cat, (buckets.get(cat) ?? 0) + 1)
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-danger">
            {failed.length} failed attempt{failed.length === 1 ? '' : 's'}
            {compact ? ' — expand a row below to see why' : ' — review by cause'}
          </p>
          {!compact ? (
            <p className="text-2xs text-fg-muted mt-0.5">
              Expand a row in the table below for timeline and humanized errors. Group by category to spot config vs agent issues.
            </p>
          ) : null}
        </div>
      </div>
      {!compact ? (
        <div className="flex flex-wrap gap-1.5">
        {sorted.map(([category, count]) => (
          <button
            key={category}
            type="button"
            onClick={() => onReviewCategory?.(category)}
            className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-surface-raised/80 px-2 py-0.5 text-2xs hover:border-danger/40 motion-safe:transition-colors"
          >
            <Badge className="bg-danger-subtle text-danger font-mono px-1 py-0">
              {count}
            </Badge>
            <span className="text-fg-secondary">
              {CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ')}
            </span>
          </button>
        ))}
        {onReviewCategory && (
          <Btn size="sm" variant="ghost" className="!text-2xs !py-0.5" onClick={() => onReviewCategory('')}>
            Show all failed
          </Btn>
        )}
      </div>
      ) : null}
    </div>
  )
}
