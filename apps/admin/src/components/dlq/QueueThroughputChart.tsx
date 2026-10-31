/**
 * FILE: apps/admin/src/components/dlq/QueueThroughputChart.tsx
 * PURPOSE: 14-day created vs completed vs failed throughput sparklines.
 *          Renders nothing when there's been no traffic — empty days don't
 *          deserve their own card.
 */

import { Card } from '../ui'
import { BarSparkline } from '../charts'
import { ChartActionsMenu } from '../ChartActionsMenu'
import type { ThroughputDay } from './types'

interface Props {
  throughput: ThroughputDay[]
}

export function QueueThroughputChart({ throughput }: Props) {
  if (throughput.length === 0 || !throughput.some((d) => d.created > 0)) {
    return null
  }

  return (
    <Card elevated className="p-3">
      {/* Hyphens are wrap points, so a squeezed range splits after "2026-10-".
          nowrap keeps the whole range together; the header wraps it under
          the title when the row is narrower than both (390px). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 mb-1">
        <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
          Daily throughput · last 14d
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-fg-faint whitespace-nowrap shrink-0">
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div>
          <div className="text-3xs font-medium uppercase tracking-wider text-fg-faint mb-1 flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-info/70" aria-hidden="true" />
            Created
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
        <div>
          <div className="text-3xs font-medium uppercase tracking-wider text-fg-faint mb-1 flex items-center gap-1.5">
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
        <div>
          <div className="text-3xs font-medium uppercase tracking-wider text-fg-faint mb-1 flex items-center gap-1.5">
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
      </div>
    </Card>
  )
}
