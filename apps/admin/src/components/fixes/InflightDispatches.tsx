/**
 * FILE: apps/admin/src/components/fixes/InflightDispatches.tsx
 * PURPOSE: Compact list of dispatch jobs that are currently queued or running.
 *          Lets the user see the request *before* the FixAttempt row exists.
 */

import { Link } from 'react-router-dom'
import { Card, Badge, RelativeTime } from '../ui'
import { statusGlowClass } from '../../lib/tokens'
import { DISPATCH_STATUS, DISPATCH_STATUS_LABEL, type DispatchJob } from './types'

interface Props {
  dispatches: DispatchJob[]
}

export function InflightDispatches({ dispatches }: Props) {
  const active = dispatches.filter((d) => d.status === 'queued' || d.status === 'running')
  if (active.length === 0) return null

  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">In-flight dispatches</h3>
      {active.map((d) => (
        <Card key={d.id} className={`p-3 space-y-1 ${statusGlowClass(d.status)}`}>
          <div className="flex justify-between items-center">
            <Badge className={DISPATCH_STATUS[d.status]}>{DISPATCH_STATUS_LABEL[d.status]}</Badge>
            <Link
              to={`/reports/${d.report_id}`}
              className="text-2xs font-mono text-fg-muted hover:text-fg-secondary"
            >
              Report {d.report_id.slice(0, 8)}…
            </Link>
          </div>
          <p className="text-2xs text-fg-muted">
            Queued <RelativeTime value={d.created_at} />
            {d.started_at && <> · started <RelativeTime value={d.started_at} /></>}
          </p>
        </Card>
      ))}
    </div>
  )
}
