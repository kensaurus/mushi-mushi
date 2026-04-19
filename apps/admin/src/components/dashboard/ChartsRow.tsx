/**
 * FILE: apps/admin/src/components/dashboard/ChartsRow.tsx
 * PURPOSE: Two side-by-side cards: 14d severity-stacked report intake +
 *          14d LLM tokens/calls sparklines. Pure presentation.
 */

import { Link } from 'react-router-dom'
import { Card } from '../ui'
import { SeverityStackedBars, LineSparkline, formatTokens } from '../charts'
import type { LlmDay, ReportDay } from './types'

interface Props {
  reportsByDay: ReportDay[]
  llmByDay: LlmDay[]
  totalLlmCalls: number
}

export function ChartsRow({ reportsByDay, llmByDay, totalLlmCalls }: Props) {
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
            <LineSparkline values={llmByDay.map((d) => d.tokens)} />
            <div className="text-3xs font-mono text-fg-faint mt-0.5">
              peak {formatTokens(Math.max(0, ...llmByDay.map((d) => d.tokens)))}
            </div>
          </div>
          <div>
            <div className="text-2xs text-fg-muted">Calls / day</div>
            <LineSparkline values={llmByDay.map((d) => d.calls)} accent="text-info" />
            <div className="text-3xs font-mono text-fg-faint mt-0.5">{totalLlmCalls} total</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
