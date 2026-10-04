/**
 * FILE: apps/admin/src/components/charts/SeverityColorLegend.tsx
 * PURPOSE: Traffic-light severity legend with visible text labels, plus a
 *          single-swatch helper for dense rows.
 *
 * The legend was colour-only (label on hover), and medium shared critical's
 * red, so a chart's dots could not be read (2026-10-04 audit).
 */

import { SEVERITY_TRAFFIC, SEVERITY_TRAFFIC_ORDER, severityTrafficBg, severityTrafficLabel } from '../../lib/severityTraffic'
import { Tooltip } from '../ui'

export function SeverityColorLegend({ showUnscored }: { showUnscored?: boolean }) {
  const items = SEVERITY_TRAFFIC_ORDER.filter(
    (key) => showUnscored || key !== 'unscored',
  ).map((key) => SEVERITY_TRAFFIC[key])

  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Severity legend">
      {items.map(({ label, bg }) => (
        <li key={label} className="inline-flex items-center gap-1 text-3xs text-fg-muted">
          <span className={`block h-2.5 w-2.5 rounded-sm ${bg}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
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
