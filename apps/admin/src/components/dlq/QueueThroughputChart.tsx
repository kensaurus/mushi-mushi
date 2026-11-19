/**
 * FILE: apps/admin/src/components/dlq/QueueThroughputChart.tsx
 * PURPOSE: 14-day created vs completed vs failed throughput sparklines.
 *          Renders nothing when there's been no traffic — empty days don't
 *          deserve their own card. Two active days are one line of totals, and
 *          identical created/completed series are one chart (2026-11-18).
 */

import { Card } from '../ui'
import { BarSparkline } from '../charts'
import { ChartActionsMenu } from '../ChartActionsMenu'
import type { ThroughputDay } from './types'

interface Props {
  throughput: ThroughputDay[]
}

export type ThroughputShape =
  | { kind: 'none' }
  /** Too few active days for a chart to show a trend: one line of totals. */
  | { kind: 'totals'; created: number; completed: number; failed: number; activeDays: number }
  /** Every job created was completed the same day: one chart, not two identical ones. */
  | { kind: 'merged'; anyFailed: boolean }
  | { kind: 'split'; anyFailed: boolean }

/** Fewer active days than this and the bars are a dot or two: say the totals instead. */
const MIN_CHART_DAYS = 3

/** What the throughput card should draw. @internal Exported for tests. */
export function throughputShape(throughput: readonly ThroughputDay[]): ThroughputShape {
  if (throughput.length === 0 || !throughput.some((d) => d.created > 0)) return { kind: 'none' }
  const sum = (k: 'created' | 'completed' | 'failed') => throughput.reduce((n, d) => n + d[k], 0)
  const activeDays = throughput.filter((d) => d.created > 0 || d.completed > 0 || d.failed > 0).length
  // An empty Failed / DLQ panel is a third chart of nothing (2026-11-18): drop it.
  const anyFailed = throughput.some((d) => d.failed > 0)
  if (activeDays < MIN_CHART_DAYS) return { kind: 'totals', created: sum('created'), completed: sum('completed'), failed: sum('failed'), activeDays }
  if (throughput.every((d) => d.created === d.completed)) return { kind: 'merged', anyFailed }
  return { kind: 'split', anyFailed }
}

export function QueueThroughputChart({ throughput }: Props) {
  const shape = throughputShape(throughput)
  if (shape.kind === 'none') return null
  if (shape.kind === 'totals') {
    const parts = [`${shape.created} created`, `${shape.completed} completed`, ...(shape.failed > 0 ? [`${shape.failed} failed`] : [])]
    return (
      <p className="text-xs text-fg-secondary" data-testid="throughput-totals">
        Last 14 days: <span className="font-semibold text-fg tabular-nums">{parts.join(' · ')}</span>{' '}
        <span className="text-fg-muted">(on {shape.activeDays} day{shape.activeDays === 1 ? '' : 's'}; not enough for a chart)</span>
      </p>
    )
  }
  const anyFailed = shape.anyFailed
  const merged = shape.kind === 'merged'
  const panels = (merged ? 1 : 2) + (anyFailed ? 1 : 0)

  return (
    <Card elevated className="p-3">
      {/* Hyphens are wrap points, so a squeezed range splits after "2026-10-".
          nowrap keeps the whole range together; the header wraps it under
          the title when the row is narrower than both (390px). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 mb-1">
        <h3 className="text-2xs text-fg-secondary font-semibold">
          Daily throughput · last 14d
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-fg-faint tabular-nums whitespace-nowrap shrink-0">
            {throughput[0]?.day} → {throughput[throughput.length - 1]?.day}
          </span>
          <ChartActionsMenu
            label="Daily throughput"
            exportFilename={`queue-throughput-${new Date().toISOString().slice(0, 10)}.csv`}
            onExportCsv={() => {
              const header = 'day,created,completed,failed'
              const rows = throughput.map((d) => `${d.day},${d.created},${d.completed},${d.failed}`)
              return [header, ...rows].join('\n')
            }}
            openFilterTo="/queue?status=failed"
            openFilterLabel="Open failed lane"
          />
        </div>
      </div>
      <div className={`grid grid-cols-1 gap-4 ${panels === 3 ? 'lg:grid-cols-3' : panels === 2 ? 'lg:grid-cols-2' : ''}`}>
        <div data-testid="throughput-created">
          <div className="text-3xs font-semibold text-fg-secondary mb-1 flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-info/70" aria-hidden="true" />
            {merged ? 'Created · every one completed the same day' : 'Created'}
          </div>
          <BarSparkline
            values={throughput.map((d) => d.created)}
            xLabels={throughput.map((d) => d.day)}
            accent="bg-info/70"
            height={64}
            showAxes
            valueFormat="count"
            yAxisCaption="Jobs"
            showPeakLabel
          />
        </div>
        {!merged && (
        <div data-testid="throughput-completed">
          <div className="text-3xs font-semibold text-fg-secondary mb-1 flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok/70" aria-hidden="true" />
            Completed
          </div>
          <BarSparkline
            values={throughput.map((d) => d.completed)}
            xLabels={throughput.map((d) => d.day)}
            accent="bg-ok/70"
            height={64}
            showAxes
            valueFormat="count"
            yAxisCaption="Jobs"
            showPeakLabel
          />
        </div>
        )}
        {anyFailed && (
        <div data-testid="throughput-failed">
          <div className="text-3xs font-semibold text-fg-secondary mb-1 flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger/70" aria-hidden="true" />
            Failed / DLQ
          </div>
          <BarSparkline
            values={throughput.map((d) => d.failed)}
            xLabels={throughput.map((d) => d.day)}
            accent="bg-danger/70"
            height={64}
            showAxes
            valueFormat="count"
            yAxisCaption="Jobs"
            showPeakLabel
          />
        </div>
        )}
      </div>
    </Card>
  )
}
