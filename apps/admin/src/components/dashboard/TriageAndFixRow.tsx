/**
 * FILE: apps/admin/src/components/dashboard/TriageAndFixRow.tsx
 * PURPOSE: 2/3-1/3 split: triage queue (clickable rows into report detail)
 *          plus a visual auto-fix pipeline meter with a single CTA.
 */

import { Link } from 'react-router-dom'
import { Card, PanelHeader } from '../ui'
import { StatusPill } from '../charts'
import { SeveritySwatch } from '../charts/SeverityColorLegend'
import { relTime, type FixSummary, type TriageItem } from './types'
import { ActionPill, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { FixPipelineMeter } from './FixPipelineMeter'
import { useAdminMode } from '../../lib/mode'

interface Props {
  triageQueue: TriageItem[]
  fixSummary: FixSummary
}

export function TriageAndFixRow({ triageQueue, fixSummary }: Props) {
  const { isAdvanced } = useAdminMode()
  const hasCritical = triageQueue.some((r) => r.severity === 'critical' || r.severity === 'high')
  const queueTitle = isAdvanced ? 'Triage queue' : 'Bug queue'

  return (
    <div className="mb-3 grid grid-cols-1 gap-2.5 lg:grid-cols-3">
      <Card className="min-w-0 p-3 lg:col-span-2">
        <PanelHeader
          title={queueTitle}
          action={
            <div className="flex min-w-0 items-center gap-2">
              {hasCritical && (
                <SignalChip tone="warn" className="motion-safe:animate-pulse">
                  Needs attention
                </SignalChip>
              )}
              <ActionPill to="/reports?status=new" tone="brand">
                View backlog →
              </ActionPill>
            </div>
          }
        />
        {triageQueue.length === 0 ? (
          <EmptySectionMessage
            text="All caught up — no bugs waiting for review."
            hint="New bugs land here within seconds of the SDK sending a report."
          />
        ) : (
          <div className="space-y-1.5">
            {triageQueue.map((r) => (
              <Link
                key={r.id}
                to={`/reports/${r.id}`}
                className="group block rounded-md border border-edge-subtle/70 bg-surface-overlay/25 px-2 py-1.5 motion-safe:transition-colors hover:border-edge hover:bg-surface-overlay/45"
              >
                <div className="flex items-center gap-2">
                  <StatusPill status={r.status} />
                  <SeveritySwatch severity={r.severity} />
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary group-hover:text-fg">
                    {r.summary}
                  </span>
                  <SignalChip tone="neutral">{relTime(r.created_at)}</SignalChip>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card className="min-w-0 p-3">
        <PanelHeader
          title="Auto-fix"
          action={
            <ActionPill to="/fixes" tone="brand">
              All →
            </ActionPill>
          }
        />
        <FixPipelineMeter fixSummary={fixSummary} />
      </Card>
    </div>
  )
}
