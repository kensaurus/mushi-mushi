/**
 * FILE: apps/admin/src/components/dashboard/TriageAndFixRow.tsx
 * PURPOSE: 2/3-1/3 split: triage queue (clickable rows into report detail)
 *          plus a 4-tile auto-fix summary card with a CTA into /fixes.
 */

import { Link } from 'react-router-dom'
import { Card, Badge } from '../ui'
import { StatusPill } from '../charts'
import { SEVERITY } from '../../lib/tokens'
import { relTime, type FixSummary, type TriageItem } from './types'

interface Props {
  triageQueue: TriageItem[]
  fixSummary: FixSummary
}

export function TriageAndFixRow({ triageQueue, fixSummary }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
      <Card className="p-3 lg:col-span-2">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Triage queue</h3>
          <Link to="/reports?status=new" className="text-2xs text-brand hover:text-brand-hover">
            View backlog →
          </Link>
        </div>
        {triageQueue.length === 0 ? (
          <p className="text-2xs text-fg-faint py-4 text-center">All caught up — no untriaged reports.</p>
        ) : (
          <div className="space-y-1">
            {triageQueue.map((r) => (
              <Link
                key={r.id}
                to={`/reports/${r.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-overlay/50 transition-colors group"
              >
                <StatusPill status={r.status} />
                {r.severity && (
                  <Badge className={SEVERITY[r.severity] ?? 'bg-fg-faint/15 text-fg-muted'}>
                    {r.severity}
                  </Badge>
                )}
                <span className="text-xs text-fg-secondary group-hover:text-fg flex-1 truncate">{r.summary}</span>
                <span className="text-3xs font-mono text-fg-faint shrink-0">{relTime(r.created_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Auto-fix</h3>
          <Link to="/fixes" className="text-2xs text-brand hover:text-brand-hover">
            All →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FixStat label="Total" value={fixSummary.total} />
          <FixStat label="Open PRs" value={fixSummary.openPrs} accent="text-ok" />
          <FixStat label="In progress" value={fixSummary.inProgress} accent="text-info" />
          <FixStat
            label="Failed"
            value={fixSummary.failed}
            accent={fixSummary.failed > 0 ? 'text-danger' : undefined}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-edge-subtle">
          <Link to="/fixes" className="text-2xs text-fg-muted hover:text-fg">
            {fixSummary.openPrs > 0
              ? `${fixSummary.openPrs} draft PR${fixSummary.openPrs === 1 ? '' : 's'} ready for review →`
              : 'Dispatch a fix from a report →'}
          </Link>
        </div>
      </Card>
    </div>
  )
}

function FixStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-surface-overlay/40 rounded-sm px-2 py-1.5 border border-edge-subtle">
      <div className="text-3xs text-fg-muted uppercase tracking-wider">{label}</div>
      <div className={`text-base font-semibold font-mono ${accent ?? 'text-fg'}`}>{value}</div>
    </div>
  )
}
