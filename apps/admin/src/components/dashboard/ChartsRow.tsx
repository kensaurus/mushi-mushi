/**
 * FILE: apps/admin/src/components/dashboard/ChartsRow.tsx
 * PURPOSE: Two side-by-side cards: 14d severity-stacked report intake +
 *          14d LLM tokens/calls sparklines. Pure presentation.
 */

import { Link, useNavigate } from 'react-router-dom'
import { Card } from '../ui'
import { SeverityStackedBars, LineSparkline, formatTokens } from '../charts'
import { ChartAnnotations } from '../charts/ChartAnnotations'
import type { LlmDay, ReportDay } from './types'
import type { ChartEvent } from '../../lib/apiSchemas'

interface Props {
  reportsByDay: ReportDay[]
  llmByDay: LlmDay[]
  totalLlmCalls: number
  /** Wave T.5.8b: optional event overlay. Forwarded from DashboardPage
   *  which owns the chart-events query. Defaults to `[]` so existing
   *  render tests don't have to stub the query. */
  chartEvents?: ChartEvent[]
}

export function ChartsRow({ reportsByDay, llmByDay, totalLlmCalls, chartEvents = [] }: Props) {
  const navigate = useNavigate()
  // Wave T.4.7b: brushing the LLM sparklines deep-links to Reports filtered
  // by the same window. Each day already carries an ISO date; we align
  // those with the sparkline values so the brush commit emits concrete
  // from/to strings we can serialise into URL state.
  const llmTimestamps = llmByDay.map((d) => d.day)
  const onLlmRange = (range: { fromIso: string; toIso: string }) => {
    const next = new URLSearchParams()
    next.set('from', range.fromIso)
    next.set('to', range.toIso)
    navigate(`/reports?${next.toString()}`)
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Report intake (14d)</h3>
          <Link to="/reports" className="text-2xs text-brand hover:text-brand-hover">All reports →</Link>
        </div>
        <SeverityStackedBars data={reportsByDay} />
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">LLM activity (14d)</h3>
          <Link to="/health" className="text-2xs text-brand hover:text-brand-hover">Health →</Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-2xs text-fg-muted">Tokens / day</div>
            <div className="relative">
              <LineSparkline
                values={llmByDay.map((d) => d.tokens)}
                timestamps={llmTimestamps}
                onRangeSelect={onLlmRange}
                ariaLabel="LLM tokens per day — drag to filter reports by date range"
              />
              {llmTimestamps.length > 1 && chartEvents.length > 0 && (
                <ChartAnnotations
                  events={chartEvents}
                  fromIso={llmTimestamps[0]}
                  toIso={llmTimestamps[llmTimestamps.length - 1]}
                  variant="dot"
                  ariaLabel="LLM tokens annotations"
                />
              )}
            </div>
            <div className="text-3xs font-mono text-fg-faint mt-0.5">
              peak {formatTokens(Math.max(0, ...llmByDay.map((d) => d.tokens)))}
            </div>
          </div>
          <div>
            <div className="text-2xs text-fg-muted">Calls / day</div>
            <div className="relative">
              <LineSparkline
                values={llmByDay.map((d) => d.calls)}
                timestamps={llmTimestamps}
                onRangeSelect={onLlmRange}
                accent="text-info"
                ariaLabel="LLM calls per day — drag to filter reports by date range"
              />
              {llmTimestamps.length > 1 && chartEvents.length > 0 && (
                <ChartAnnotations
                  events={chartEvents}
                  fromIso={llmTimestamps[0]}
                  toIso={llmTimestamps[llmTimestamps.length - 1]}
                  variant="dot"
                  ariaLabel="LLM calls annotations"
                />
              )}
            </div>
            <div className="text-3xs font-mono text-fg-faint mt-0.5">{totalLlmCalls} total</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
