/**
 * FILE: apps/admin/src/components/dashboard/TriageAndFixRow.tsx
 * PURPOSE: The top three reports waiting for triage, linking on to the To-do
 *          list. Backlog and auto-fix counts live in the KPI row above.
 */

import { Link } from 'react-router-dom'
import { Card, PanelHeader } from '../ui'
import { StatusPill } from '../charts'
import { SeveritySwatch } from '../charts/SeverityColorLegend'
import { relTime, type TriageItem } from './types'
import { ActionPill, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'

interface Props {
  triageQueue: TriageItem[]
}

const TOP_N = 3

export function TriageAndFixRow({ triageQueue }: Props) {
  const top = triageQueue.slice(0, TOP_N)

  return (
    <div className="mb-3">
      <Card className="min-w-0 p-3">
        <PanelHeader
          title={`Top ${TOP_N} to triage`}
          action={
            <ActionPill to="/inbox" tone="brand">
              Open To-do →
            </ActionPill>
          }
        />
        {top.length === 0 ? (
          <EmptySectionMessage
            text="All caught up — no bugs waiting for review."
            hint="New bugs land here within seconds of the SDK sending a report."
          />
        ) : (
          <div className="space-y-1.5">
            {top.map((r) => (
              <Link
                key={r.id}
                to={`/reports/${r.id}`}
                className="group block rounded-md border border-edge-subtle/70 bg-surface-overlay/25 px-2 py-1.5 motion-safe:transition-opacity hover:border-edge hover:bg-surface-overlay/45"
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
    </div>
  )
}
