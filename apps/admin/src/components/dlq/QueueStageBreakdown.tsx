/**
 * FILE: apps/admin/src/components/dlq/QueueStageBreakdown.tsx
 * PURPOSE: Per-stage backlog bar — one row per pipeline stage showing the
 *          status mix (pending / running / completed / failed / DLQ).
 *          Click a row to scope the page filter to that stage.
 */

import { Card } from '../ui'
import { ChartActionsMenu } from '../ChartActionsMenu'
import type { QueueSummary } from './types'

interface Props {
  summary: QueueSummary
  selectedStage: string
  onSelect: (stage: string) => void
}

const STATUS_ORDER = ['pending', 'running', 'completed', 'failed', 'dead_letter'] as const
const STATUS_BAR_CLS: Record<(typeof STATUS_ORDER)[number], string> = {
  pending: 'bg-info',
  running: 'bg-brand',
  completed: 'bg-ok',
  failed: 'bg-warn',
  dead_letter: 'bg-danger',
}

export function QueueStageBreakdown({ summary, selectedStage, onSelect }: Props) {
  if (summary.stages.length === 0) return null

  return (
    <Card elevated className="p-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
          Backlog by stage
        </h3>
        <ChartActionsMenu
          label="Backlog by stage"
          exportFilename={`queue-stage-breakdown-${new Date().toISOString().slice(0, 10)}.csv`}
          onExportCsv={() => {
            const header = ['stage', ...STATUS_ORDER].join(',')
            const rows = summary.stages.map((s) => {
              const b = summary.byStage[s] ?? {}
              return [s, ...STATUS_ORDER.map((st) => b[st] ?? 0)].join(',')
            })
            return [header, ...rows].join('\n')
          }}
          openFilterTo="/queue?status=dead_letter"
          openFilterLabel="Open dead-letter lane"
        />
      </div>
      <div className="space-y-1.5">
        {summary.stages.map((s) => {
          const breakdown = summary.byStage[s] ?? {}
          const totalForStage = Object.values(breakdown).reduce((a, b) => a + b, 0)
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s === selectedStage ? '' : s)}
              className={`w-full grid grid-cols-[8rem_1fr_5rem] items-center gap-3 px-2 py-1.5 rounded-sm text-left transition-colors ${
                selectedStage === s ? 'bg-brand/10 ring-1 ring-brand/40' : 'hover:bg-surface-overlay'
              }`}
            >
              <span className="text-xs font-mono text-fg-secondary">{s}</span>
              <div className="flex h-2 rounded-sm overflow-hidden bg-edge-subtle">
                {STATUS_ORDER.map((st) => {
                  const v = breakdown[st] ?? 0
                  if (v === 0) return null
                  return (
                    <div
                      key={st}
                      className={STATUS_BAR_CLS[st]}
                      style={{ width: `${(v / totalForStage) * 100}%` }}
                      title={`${st}: ${v}`}
                    />
                  )
                })}
              </div>
              <span className="text-2xs font-mono text-fg-muted text-right">{totalForStage}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
