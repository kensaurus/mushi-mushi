/**
 * FILE: apps/admin/src/components/pdca-flow/PipelineActivityLog.tsx
 * PURPOSE: Compact tick-tape of pipeline events rendered inside a React
 *          Flow <Panel> at the bottom of the PDCA canvas. Streams the
 *          most recent activity items from the dashboard payload (already
 *          polled every 15s by DashboardPage) so the user can see the
 *          loop pulsing without leaving the diagram.
 *
 *          Intentionally tiny — 5 most-recent rows, mono-spaced, fade-in
 *          so new events don't jank the layout.
 */

import { useMemo } from 'react'
import type { ActivityItem } from '../dashboard/types'
import { relTime } from '../dashboard/types'

interface PipelineActivityLogProps {
  activity: ActivityItem[]
  max?: number
}

export function PipelineActivityLog({ activity, max = 5 }: PipelineActivityLogProps) {
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
        {items.map((item) => (
          <li
            key={`${item.kind}-${item.id}`}
            className="flex items-center gap-1.5 motion-safe:animate-mushi-fade-in"
          >
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
          </li>
        ))}
      </ul>
    </div>
  )
}
