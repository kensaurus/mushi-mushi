/**
 * FILE: apps/admin/src/components/pdca-flow/PipelineActivityLog.tsx
 * PURPOSE: Compact tick-tape of pipeline events rendered inside the PDCA
 *          canvas at `bottom-left` — Plan sits mid-left so the bottom-left
 *          corner is empty for the log, and Act (bottom-center) stays
 *          unobscured. Streams the most recent activity items from the
 *          dashboard payload (already polled every 15s by DashboardPage)
 *          so the user can see the loop pulsing without leaving the
 *          diagram.
 *
 *          Intentionally tiny — 5 most-recent rows, mono-spaced, fade-in
 *          so new events don't jank the layout.
 */

import { useMemo } from 'react'
import type { ActivityItem } from '../dashboard/types'
import { relTime } from '../dashboard/types'
import type { PdcaStageId } from '../../lib/pdca'

// Rough kind → stage mapping so clicking a row flies the canvas to the
// most likely node (e.g. "fix completed" → Act). Keeps the UX direction
// one-way: log is truth; canvas is the lens.
const KIND_TO_STAGE: Record<ActivityItem['kind'], PdcaStageId> = {
  report: 'plan',
  fix: 'do',
}

interface PipelineActivityLogProps {
  activity: ActivityItem[]
  max?: number
  /** Optional callback that focuses the matching stage node. */
  onFocusStage?: (stage: PdcaStageId) => void
}

export function PipelineActivityLog({ activity, max = 5, onFocusStage }: PipelineActivityLogProps) {
  const items = useMemo(() => activity.slice(0, max), [activity, max])
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-edge/70 bg-surface-overlay/90 shadow-card backdrop-blur-sm px-2.5 py-1.5 text-2xs text-fg-faint">
        No pipeline events yet. Submit your first report to start the loop.
      </div>
    )
  }
  return (
    <div
      className="rounded-md border border-edge/70 bg-surface-overlay/90 shadow-card backdrop-blur-sm px-2.5 py-1.5 text-2xs max-w-[28rem]"
      role="log"
      aria-live="polite"
      aria-label="Recent pipeline activity"
    >
      <p className="font-medium text-fg-muted uppercase tracking-wider text-[9px] mb-0.5">
        Live activity
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const stage = KIND_TO_STAGE[item.kind]
          const content = (
            <>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                  item.kind === 'report' ? 'bg-info' : 'bg-brand'
                }`}
                aria-hidden="true"
              />
              <span className="font-mono text-[10px] text-fg-faint tabular-nums shrink-0">
                {relTime(item.at)}
              </span>
              <span className="text-fg-secondary truncate">{item.label}</span>
            </>
          )
          const key = `${item.kind}-${item.id}`
          if (!onFocusStage) {
            return (
              <li key={key} className="flex items-center gap-1.5 motion-safe:animate-mushi-fade-in">
                {content}
              </li>
            )
          }
          return (
            <li key={key} className="motion-safe:animate-mushi-fade-in">
              <button
                type="button"
                onClick={() => onFocusStage(stage)}
                title={`Focus ${stage} stage on canvas`}
                className="w-full flex items-center gap-1.5 text-left hover:bg-surface-raised rounded-sm px-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
              >
                {content}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
