/**
 * FILE: apps/admin/src/components/dashboard/QuickFiltersCard.tsx
 * PURPOSE: Clickable category + severity chips that link straight into the
 *          /reports view with the matching filter applied.
 */

import { Link } from 'react-router-dom'
import { Card } from '../ui'
import { CATEGORY_LABELS, SEVERITY } from '../../lib/tokens'

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

export function QuickFiltersCard() {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Quick filters</h3>
        <Link to="/reports" className="text-2xs text-brand hover:text-brand-hover">All filters →</Link>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(CATEGORY_LABELS).map((cat) => (
          <Link
            key={cat}
            to={`/reports?category=${cat}`}
            className="text-2xs px-2 py-1 rounded-sm bg-surface-overlay/50 text-fg-secondary hover:bg-surface-overlay hover:text-fg transition-colors border border-edge-subtle"
          >
            {CATEGORY_LABELS[cat]}
          </Link>
        ))}
        {SEVERITIES.map((sev) => (
          <Link
            key={sev}
            to={`/reports?severity=${sev}`}
            className={`text-2xs px-2 py-1 rounded-sm border transition-colors ${SEVERITY[sev] ?? ''} hover:brightness-110`}
          >
            {sev}
          </Link>
        ))}
      </div>
    </Card>
  )
}
