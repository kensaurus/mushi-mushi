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
import { ActionPill, ActionPillRow, ContainedBlock, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'

interface Props {
  triageQueue: TriageItem[]
  fixSummary: FixSummary
}

export function TriageAndFixRow({ triageQueue, fixSummary }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
      <Card className="p-3 lg:col-span-2">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Triage queue</h3>
          <ActionPill to="/reports?status=new" tone="brand">
            View backlog →
          </ActionPill>
        </div>
        {triageQueue.length === 0 ? (
          <EmptySectionMessage
            text="All caught up — no untriaged reports."
            hint="New bugs land here within seconds of SDK ingest."
          />
        ) : (
          <div className="space-y-1.5">
            {triageQueue.map((r) => (
              <Link
                key={r.id}
                to={`/reports/${r.id}`}
                className="block rounded-md border border-edge-subtle/70 bg-surface-overlay/25 px-2 py-1.5 motion-safe:transition-colors hover:border-edge hover:bg-surface-overlay/45 group"
              >
                <div className="flex items-center gap-2">
                  <StatusPill status={r.status} />
                  {r.severity ? (
                    <Badge className={SEVERITY[r.severity] ?? 'bg-fg-faint/15 text-fg-muted'}>
                      {r.severity}
                    </Badge>
                  ) : null}
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

      <Card className="p-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Auto-fix</h3>
          <ActionPill to="/fixes" tone="brand">
            All →
          </ActionPill>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FixStat label="Total" value={fixSummary.total} />
          <FixStat label="Open PRs" value={fixSummary.openPrs} accent="text-ok" />
          <FixStat label="In progress" value={fixSummary.inProgress} accent="text-info" />
          <FixStat
            label="Failed"
            value={fixSummary.failed}
            accent={fixSummary.failed > 0 ? 'text-danger' : undefined}
            highlight={fixSummary.failed > 0}
          />
        </div>
        <ContainedBlock tone="muted" className="mt-3">
          <ActionPillRow>
            <ActionPill to="/fixes" tone={fixSummary.openPrs > 0 ? 'ok' : 'neutral'}>
              {fixSummary.openPrs > 0
                ? `${fixSummary.openPrs} draft PR${fixSummary.openPrs === 1 ? '' : 's'} ready for review →`
                : 'Dispatch a fix from a report →'}
            </ActionPill>
          </ActionPillRow>
        </ContainedBlock>
      </Card>
    </div>
  )
}

function FixStat({
  label,
  value,
  accent,
  highlight,
}: {
  label: string
  value: number
  accent?: string
  highlight?: boolean
}) {
  return (
    <ContainedBlock
      tone={highlight ? 'warn' : 'neutral'}
      className="px-2 py-1.5"
    >
      <div className="text-3xs text-fg-muted uppercase tracking-wider">{label}</div>
      <div className={`text-base font-semibold font-mono tabular-nums ${accent ?? 'text-fg'}`}>{value}</div>
    </ContainedBlock>
  )
}
