/**
 * FILE: apps/admin/src/pages/CostPage.tsx
 * PURPOSE: LLM cost discipline console — view spending by operation, model, and day.
 *   Cross-cutting phase of the closed-loop evolution plan.
 *
 *   Shows:
 *     - Total spend this month
 *     - Spend by operation (clusterer, pdca, release-builder, etc.)
 *     - Spend by model
 *     - Daily spend sparkline
 *     - Raw log with pagination
 */

import { useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectSignal } from '../lib/activeProject'
import {
  PageHeader,
  PageHelp,
  Card,
  Section,
  EmptyState,
  ErrorAlert,
  RelativeTime,
  StatCard,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CostRow {
  id: string
  project_id: string
  operation: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  occurred_at: string
}

interface SummaryRow {
  day: string
  operation: string
  model: string
  total_cost_usd: number
  calls: number
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CostPage() {
  const [searchParams] = useSearchParams()
  const activeProjectSignal = useActiveProjectSignal()
  const projectId = searchParams.get('project_id') || activeProjectSignal

  usePublishPageContext({
    route: '/cost',
    title: 'Costs',
    summary: 'LLM cost tracking — token usage, spend by model, and cost-per-call analytics.',
    filters: { project_id: projectId ?? undefined },
  })

  const {
    data: rawData,
    loading: rawLoading,
    error: rawError,
  } = usePageData<{ data: CostRow[]; total: number }>(
    projectId ? `/v1/admin/costs?project_id=${projectId}&limit=200` : null,
    { deps: [projectId] },
  )

  const {
    data: summaryData,
    loading: summaryLoading,
  } = usePageData<{ data: SummaryRow[] }>(
    projectId ? `/v1/admin/costs/summary?project_id=${projectId}` : null,
    { deps: [projectId] },
  )

  const rows = rawData?.data ?? []
  const summary = summaryData?.data ?? []

  const totalSpend = rows.reduce((s, r) => s + Number(r.cost_usd), 0)

  const byOp = summary.reduce<Record<string, number>>((acc, s) => {
    acc[s.operation] = (acc[s.operation] ?? 0) + Number(s.total_cost_usd)
    return acc
  }, {})

  const byModel = summary.reduce<Record<string, number>>((acc, s) => {
    acc[s.model] = (acc[s.model] ?? 0) + Number(s.total_cost_usd)
    return acc
  }, {})

  const byDay = summary.reduce<Record<string, number>>((acc, s) => {
    const day = s.day?.slice(0, 10) ?? 'unknown'
    acc[day] = (acc[day] ?? 0) + Number(s.total_cost_usd)
    return acc
  }, {})
  const dayKeys = Object.keys(byDay).sort()
  const dayVals = dayKeys.map(d => byDay[d])
  const maxDay = Math.max(...dayVals, 0.001)

  return (
    <div className="space-y-4">
      <PageHeader
        title="LLM Cost"
        description="Track and audit every LLM call across the closed-loop pipeline — clusterer, PDCA, releases, drift, anomalies."
      />
      <PageHelp
        title="LLM cost tracking"
        whatIsIt="Every new LLM call routes through the llm_cost_usd table. Use this panel to catch runaway operations before they inflate your bill."
        useCases={[
          'Audit which operation is spending the most',
          'Compare costs across models (Opus vs GPT-5)',
          'Set informal budgets by watching daily sparkline trends',
        ]}
        howToUse="Select a project. Costs appear automatically as edge functions run. Use the By Operation table to find expensive operations."
      />

      <Section title="Spend overview">
        {!projectId && <EmptyState title="Select a project" />}
        {projectId && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Total logged spend" value={`$${totalSpend.toFixed(4)}`} />
              <StatCard label="Operations tracked" value={Object.keys(byOp).length} />
              <StatCard label="Models used" value={Object.keys(byModel).length} />
            </div>

            {dayKeys.length > 1 && (
              <Card className="p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Daily spend</p>
                <div className="flex items-end gap-1 h-16">
                  {dayVals.map((v, i) => (
                    <div key={dayKeys[i]}
                      title={`${dayKeys[i]}: $${v.toFixed(4)}`}
                      className="flex-1 min-w-[4px] rounded-t-sm bg-primary opacity-70 hover:opacity-100 transition-opacity"
                      style={{ height: `${Math.round((v / maxDay) * 100)}%` }} />
                  ))}
                </div>
                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                  <span>{dayKeys.at(0)}</span>
                  <span>{dayKeys.at(-1)}</span>
                </div>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Card className="p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">By operation</p>
                {summaryLoading ? <TableSkeleton rows={3} /> : Object.keys(byOp).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">No LLM calls yet — operations will appear here once edge functions run.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(byOp).sort(([, a], [, b]) => b - a).map(([op, cost]) => (
                        <tr key={op} className="border-b last:border-0">
                          <td className="py-1.5 font-mono text-xs">{op}</td>
                          <td className="py-1.5 text-right tabular-nums text-xs">${cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card className="p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">By model</p>
                {summaryLoading ? <TableSkeleton rows={3} /> : Object.keys(byModel).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">No model usage yet — models will appear here once edge functions run.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(byModel).sort(([, a], [, b]) => b - a).map(([model, cost]) => (
                        <tr key={model} className="border-b last:border-0">
                          <td className="py-1.5 font-mono text-xs truncate max-w-[160px]">{model}</td>
                          <td className="py-1.5 text-right tabular-nums text-xs">${cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Raw log (latest 200)</p>
              {rawLoading ? <TableSkeleton rows={10} /> : rawError ? <ErrorAlert message={rawError} /> : rows.length === 0 ? (
                <EmptyState title="No cost records" description="LLM calls will appear here once the edge functions are triggered." />
              ) : (
                <Card className="overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30 text-muted-foreground">
                        <th className="px-3 py-2 text-left">Operation</th>
                        <th className="px-3 py-2 text-left">Model</th>
                        <th className="px-3 py-2 text-right">In</th>
                        <th className="px-3 py-2 text-right">Out</th>
                        <th className="px-3 py-2 text-right">Cost</th>
                        <th className="px-3 py-2 text-left">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-1.5 font-mono">{r.operation}</td>
                          <td className="px-3 py-1.5 font-mono truncate max-w-[120px]">{r.model}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.input_tokens.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.output_tokens.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">${Number(r.cost_usd).toFixed(5)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground"><RelativeTime value={r.occurred_at} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
