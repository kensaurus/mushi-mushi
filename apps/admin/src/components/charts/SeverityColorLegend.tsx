/**
 * FILE: apps/admin/src/components/charts/SeverityColorLegend.tsx
 * PURPOSE: Single traffic-light severity swatch for dense rows, labelled on
 *          hover and for screen readers.
 */

import { severityTrafficBg, severityTrafficLabel } from '../../lib/severityTraffic'
import { Tooltip } from '../ui'

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
