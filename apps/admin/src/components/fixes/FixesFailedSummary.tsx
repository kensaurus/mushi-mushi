/**
 * The still-unfixed reports whose last auto-fix stopped, grouped by cause,
 * with human copy and deep links. One entry per report (its latest
 * attempt), so it agrees with the status banner and the dashboard.
 */

import { Btn } from '../ui'
import { HumanActionAlert, type HumanActionPreviewItem } from '../HumanActionAlert'
import { fixesFailedAction, fixesFailedHint, fixesFailedTitle, scopedHref } from '../../lib/humanPageHints'
import { failureCause, failureHeadline, fixCauseLabel, fixReportLabel, needsAttention } from '../../lib/fixReportTruth'
import type { FixAttempt } from './types'

interface Props {
  fixes: FixAttempt[]
  projectId?: string | null
  onReviewCategory?: (category: string) => void
  compact?: boolean
}

export function FixesFailedSummary({ fixes, projectId, onReviewCategory, compact = false }: Props) {
  const failed = fixes.filter(needsAttention)
  if (failed.length === 0) return null

  const preview: HumanActionPreviewItem[] = failed.slice(0, 3).map((f) => ({
    id: f.id,
    title: fixReportLabel(f),
    subtitle: failureHeadline(f)?.title ?? fixCauseLabel(failureCause(f)),
    href: scopedHref(`/fixes?status=failed#fix-${f.id}`, projectId),
  }))

  const buckets = new Map<string, number>()
  for (const f of failed) {
    const cat = failureCause(f)
    buckets.set(cat, (buckets.get(cat) ?? 0) + 1)
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-2">
      <HumanActionAlert
        tone="danger"
        compact={compact}
        headline={fixesFailedTitle(failed.length)}
        hint={fixesFailedHint(failed.length)}
        actionLabel={fixesFailedAction(failed.length)}
        actionHref={scopedHref('/fixes?status=failed', projectId)}
        preview={preview}
      />
      {!compact && sorted.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-2xs text-fg-muted">Common causes:</span>
          {sorted.map(([category, count]) => (
            <button
              key={category}
              type="button"
              onClick={() => onReviewCategory?.(category)}
              className="inline-flex items-center gap-1 rounded-full border border-danger/25 bg-surface-raised/80 px-2 py-0.5 text-2xs hover:border-danger/40 motion-safe:transition-opacity"
            >
              <span className="font-mono text-danger">{count}</span>
              <span className="text-fg-secondary">{fixCauseLabel(category)}</span>
            </button>
          ))}
          {onReviewCategory ? (
            <Btn size="sm" variant="ghost" className="!text-2xs !py-0.5" onClick={() => onReviewCategory('')}>
              Show all
            </Btn>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
