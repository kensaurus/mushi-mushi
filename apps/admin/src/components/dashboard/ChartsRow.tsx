/**
 * FILE: apps/admin/src/components/dashboard/ChartsRow.tsx
 * PURPOSE: Two side-by-side cards: 14d severity-stacked report intake +
 *          14d LLM tokens/calls sparklines. Pure presentation.
 */

import { Link } from 'react-router-dom'
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
  /** The server read its row cap for a chart; the KPI counts stay exact. */
  sampled?: boolean
}

const LLM_CHART_HEIGHT = 72

// No drag-to-filter on the LLM sparklines (QA 173): it opened /reports with
// from/to, which Reports does not read, so the range was silently dropped.
export function ChartsRow({ reportsByDay, llmByDay, chartEvents = [], sampled = false }: Props) {
  const llmTimestamps = llmByDay.map((d) => d.day)

  return (
    <div className="mb-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
      <Card className="@container/chart-card min-w-0 p-3">
        <PanelHeader
          title="Report intake (14d)"
          action={
            <Link to="/reports" className="shrink-0 text-2xs text-accent-foreground hover:text-accent">
              All reports →
            </Link>
          }
        />
        <SeverityStackedBars data={reportsByDay} />
        {sampled ? (
          <p className="mt-1.5 text-3xs text-fg-faint">
            Busy window: the charts draw the newest 5,000 rows. The counts above include every report.
          </p>
        ) : null}
      </Card>

      <Card className="@container/chart-card min-w-0 p-3">
        <PanelHeader
          title="LLM activity (14d)"
          action={
            <Link to="/health" className="shrink-0 text-2xs text-accent-foreground hover:text-accent">
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
                showAxes
                scaleToData
                valueFormat="count"
                showRangeSummary
                seriesLabel="Tokens"
                height={LLM_CHART_HEIGHT}
                ariaLabel="LLM tokens per day, last 14 days"
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
                accent="text-info"
                showAxes
                scaleToData
                valueFormat="count"
                showRangeSummary
                seriesLabel="Calls"
                height={LLM_CHART_HEIGHT}
                ariaLabel="LLM calls per day, last 14 days"
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
