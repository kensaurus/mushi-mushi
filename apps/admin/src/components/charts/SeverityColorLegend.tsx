/**
 * FILE: apps/admin/src/components/charts/SeverityColorLegend.tsx
 * PURPOSE: Color-only traffic-light severity swatches — label on hover.
 */

import { SEVERITY_TRAFFIC, SEVERITY_TRAFFIC_ORDER, severityTrafficBg, severityTrafficLabel } from '../../lib/severityTraffic'
import { Tooltip } from '../ui'

export function SeverityColorLegend({ showUnscored }: { showUnscored?: boolean }) {
  const items = SEVERITY_TRAFFIC_ORDER.filter(
    (key) => showUnscored || key !== 'unscored',
  ).map((key) => SEVERITY_TRAFFIC[key])

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1" role="list" aria-label="Severity legend">
      {items.map(({ label, bg }) => (
        <Tooltip key={label} content={label} side="top">
          <button
            type="button"
            role="listitem"
            aria-label={label}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm motion-safe:transition-colors hover:bg-surface-overlay/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <span className={`block h-2.5 w-2.5 rounded-sm ${bg}`} aria-hidden="true" />
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

export function SeveritySwatch({
  severity,
  className = '',
}: {
  severity: string | null | undefined
  className?: string
}) {
  const bg = severityTrafficBg(severity)
  const label = severityTrafficLabel(severity)
  if (!bg || !label) return null

  return (
    <Tooltip content={label} side="top">
      <span
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${bg} ${className}`}
        role="img"
        aria-label={`Severity: ${label}`}
      />
    </Tooltip>
  )
}
