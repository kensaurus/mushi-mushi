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
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
          Daily throughput · last 14d
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-fg-faint">
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
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-3xs text-fg-faint mb-1">Created</div>
          <BarSparkline values={throughput.map((d) => d.created)} accent="bg-info/70" height={28} />
        </div>
        <div>
          <div className="text-3xs text-fg-faint mb-1">Completed</div>
          <BarSparkline values={throughput.map((d) => d.completed)} accent="bg-ok/70" height={28} />
        </div>
        <div>
          <div className="text-3xs text-fg-faint mb-1">Failed / DLQ</div>
          <BarSparkline values={throughput.map((d) => d.failed)} accent="bg-danger/70" height={28} />
        </div>
      </div>
    </Card>
  )
}
