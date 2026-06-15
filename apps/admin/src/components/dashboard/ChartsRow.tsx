/**
 * FILE: apps/admin/src/components/dashboard/ChartsRow.tsx
 * PURPOSE: Two side-by-side cards: 14d severity-stacked report intake +
 *          14d LLM tokens/calls sparklines. Pure presentation.
 */

import { Link, useNavigate } from 'react-router-dom'
import { Card, PanelHeader, PanelSubheader } from '../ui'
import { SeverityStackedBars, LineSparkline } from '../charts'
import { ChartAnnotations } from '../charts/ChartAnnotations'
import type { LlmDay, ReportDay } from './types'
import type { ChartEvent } from '../../lib/apiSchemas'

interface Props {
  reportsByDay: ReportDay[]
  llmByDay: LlmDay[]
  /** Wave T.5.8b: optional event overlay. Forwarded from DashboardPage
   *  which owns the chart-events query. Defaults to `[]` so existing
   *  render tests don't have to stub the query. */
  chartEvents?: ChartEvent[]
}

const LLM_CHART_HEIGHT = 72

export function ChartsRow({ reportsByDay, llmByDay, chartEvents = [] }: Props) {
  const navigate = useNavigate()
  const llmTimestamps = llmByDay.map((d) => d.day)
  const onLlmRange = (range: { fromIso: string; toIso: string }) => {
    const next = new URLSearchParams()
    next.set('from', range.fromIso)
    next.set('to', range.toIso)
    navigate(`/reports?${next.toString()}`)
  }

  return (
    <div className="mb-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
      <Card className="@container/chart-card min-w-0 p-3">
        <PanelHeader
          title="Report intake (14d)"
          action={
            <Link to="/reports" className="shrink-0 text-2xs text-brand hover:text-brand-hover">
              All reports →
            </Link>
          }
        />
        <SeverityStackedBars data={reportsByDay} />
      </Card>

      <Card className="@container/chart-card min-w-0 p-3">
        <PanelHeader
          title="LLM activity (14d)"
          action={
            <Link to="/health" className="shrink-0 text-2xs text-brand hover:text-brand-hover">
              Health →
            </Link>
          }
        />
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="min-w-0">
            <PanelSubheader title="Tokens" />
            <div className="relative w-full min-w-0">
              <LineSparkline
                values={llmByDay.map((d) => d.tokens)}
                timestamps={llmTimestamps}
                onRangeSelect={onLlmRange}
                showAxes
                scaleToData
                valueFormat="count"
                showRangeSummary
                seriesLabel="Tokens"
                height={LLM_CHART_HEIGHT}
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
          </div>
          <div className="min-w-0">
            <PanelSubheader title="Calls" />
            <div className="relative w-full min-w-0">
              <LineSparkline
                values={llmByDay.map((d) => d.calls)}
                timestamps={llmTimestamps}
                onRangeSelect={onLlmRange}
                accent="text-info"
                showAxes
                scaleToData
                valueFormat="count"
                showRangeSummary
                seriesLabel="Calls"
                height={LLM_CHART_HEIGHT}
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
          </div>
        </div>
      </Card>
    </div>
  )
}
