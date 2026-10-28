/**
 * FILE: apps/admin/src/components/fixes/InflightDispatches.tsx
 * PURPOSE: Compact list of dispatch jobs that are currently queued or running,
 *          plus recent skipped / blocked / failed dispatches with their reason.
 *          Lets the user see the request *before* the FixAttempt row exists —
 *          and see WHY a dispatch stopped instead of it silently vanishing
 *          (2026-08-16 audit P1-4: skipped dispatches were invisible, which
 *          read as "auto-fix does nothing").
 */

import { Link } from 'react-router-dom'
import { Card, Badge, RelativeTime } from '../ui'
import { statusGlowClass } from '../../lib/tokens'
import { DISPATCH_STATUS, DISPATCH_STATUS_LABEL, type DispatchJob } from './types'

interface Props {
  dispatches: DispatchJob[]
}

import { stoppedDispatches } from '../../lib/fixesBannerReconcile'

function DispatchCard({ d, showReason }: { d: DispatchJob; showReason?: boolean }) {
  return (
    <Card className={`p-3 space-y-1 ${statusGlowClass(d.status)}`}>
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
        {d.finished_at && <> · ended <RelativeTime value={d.finished_at} /></>}
      </p>
      {showReason && d.error && (
        <p className="text-2xs text-warn-foreground" title={d.error}>
          {d.error.length > 160 ? `${d.error.slice(0, 160)}…` : d.error}
        </p>
      )}
    </Card>
  )
}

export function InflightDispatches({ dispatches }: Props) {
  const active = dispatches.filter((d) => d.status === 'queued' || d.status === 'running')
  // Terminal-but-actionable: the user must see the stop reason to unblock.
  // One definition with the banner reconciliation (lib/fixesBannerReconcile.ts)
  // so the cards and the status banner never disagree; a stop that a newer
  // dispatch on the same report replaced is not listed. Cap at 5 newest.
  const needsAttention = stoppedDispatches(dispatches).slice(0, 5)
  if (active.length === 0 && needsAttention.length === 0) return null

  return (
    <div className="space-y-3">
      {active.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Fix requests running</h3>
          {active.map((d) => (
            <DispatchCard key={d.id} d={d} />
          ))}
        </div>
      )}
      {needsAttention.length > 0 && (
        // Folded to one line: five full cards pushed the fix list below the
        // fold, and the reasons are only read when acting on one.
        <details className="group space-y-1.5">
          <summary className="cursor-pointer text-xs font-semibold text-fg-secondary uppercase tracking-wide">
            {/* Plain words: "5 stopped dispatches need attention" (2026-10-28). */}
            {needsAttention.length} fix {needsAttention.length === 1 ? 'request' : 'requests'} stopped without a pull request
            <span className="ml-1 font-normal normal-case tracking-normal text-fg-muted group-open:hidden">· show why</span>
          </summary>
          {needsAttention.map((d) => (
            <DispatchCard key={d.id} d={d} showReason />
          ))}
        </details>
      )}
    </div>
  )
}
