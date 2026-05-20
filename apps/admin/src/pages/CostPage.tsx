/**
 * FILE: apps/admin/src/pages/CostPage.tsx
 * PURPOSE: LLM cost discipline console — view spending by operation, model, and day.
 */

import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageCopy } from '../lib/copy'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectSignal } from '../lib/activeProject'
import {
  PageHeader,
  PageHelp,
  Card,
  Section,
  EmptyState,
  StatCard,
  Sparkline,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { CostRawLogTable } from '../components/cost/CostRawLogTable'
import { OperationChip } from '../components/OperationChip'

interface SummaryRow {
  day: string
  operation: string
  model: string
  total_cost_usd: number
  calls: number
}

function listRows<T>(payload: T[] | null | undefined): T[] {
  return Array.isArray(payload) ? payload : []
}

export function CostPage() {
  const copy = usePageCopy('/cost')
  const [searchParams] = useSearchParams()
  const activeProjectSignal = useActiveProjectSignal()
  const projectId = searchParams.get('project_id') || activeProjectSignal

  usePublishPageContext({
    route: '/cost',
    title: 'Costs',
    summary: 'LLM cost tracking — token usage, spend by model, and cost-per-call analytics.',
    filters: { project_id: projectId ?? undefined },
  })

  const { data: summaryData, loading: summaryLoading } = usePageData<SummaryRow[]>(
    projectId ? `/v1/admin/costs/summary?project_id=${projectId}` : null,
    { deps: [projectId] },
  )

  const summary = listRows(summaryData)

  const { totalSpend, byOp, byModel, dayKeys, dayVals } = useMemo(() => {
    const op: Record<string, number> = {}
    const model: Record<string, number> = {}
    const day: Record<string, number> = {}
    let spend = 0

    for (const s of summary) {
      const cost = Number(s.total_cost_usd)
      spend += cost
      op[s.operation] = (op[s.operation] ?? 0) + cost
      model[s.model] = (model[s.model] ?? 0) + cost
      const dayKey = s.day?.slice(0, 10) ?? 'unknown'
      day[dayKey] = (day[dayKey] ?? 0) + cost
    }

    const keys = Object.keys(day).sort()
    return {
      totalSpend: spend,
      byOp: op,
      byModel: model,
      dayKeys: keys,
      dayVals: keys.map((d) => day[d]),
    }
  }, [summary])

  const maxDay = Math.max(...dayVals, 0.001)

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'LLM Cost'}
        description={
          copy?.description
          ?? 'Track and audit every LLM call across classify, fix, judge, and inventory agents.'
        }
      />
      <PageHelp
        title={copy?.help?.title ?? 'About AI cost tracking'}
        whatIsIt={
          copy?.help?.whatIsIt
          ?? 'Every LLM call is logged in llm_invocations with token counts and cost_usd. This page rolls that up by operation, model, and day.'
        }
        useCases={copy?.help?.useCases ?? [
          'Audit which edge function is spending the most',
          'Compare costs across models',
          'Spot a runaway cron from the daily trend',
        ]}
        howToUse={
          copy?.help?.howToUse
          ?? 'Select a project. Costs appear as classify, fix, judge, and other agents run.'
        }
      />

      <Section title="Spend overview">
        {!projectId && <EmptyState title="Select a project" />}
        {projectId && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Total logged spend"
                value={`$${totalSpend.toFixed(4)}`}
                hint="From llm_invocations.cost_usd (primary) + legacy llm_cost_usd ledger"
              />
              <StatCard label="Operations tracked" value={Object.keys(byOp).length} />
              <StatCard label="Models used" value={Object.keys(byModel).length} />
            </div>

            {dayKeys.length > 1 && (
              <Card className="p-4">
                <p className="mb-2 text-xs font-medium text-fg-muted uppercase tracking-wide">Daily spend</p>
                <div className="flex h-16 items-end gap-1">
                  {dayVals.map((v, i) => (
                    <div
                      key={dayKeys[i]}
                      title={`${dayKeys[i]}: $${v.toFixed(4)}`}
                      className="min-w-[4px] flex-1 rounded-t-sm bg-brand opacity-70 transition-opacity hover:opacity-100"
                      style={{ height: `${Math.round((v / maxDay) * 100)}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-2xs text-fg-muted">
                  <span>{dayKeys.at(0)}</span>
                  <span>{dayKeys.at(-1)}</span>
                </div>
                <div className="mt-2">
                  <Sparkline values={dayVals} width={240} height={20} />
                </div>
              </Card>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="p-4">
                <p className="mb-3 text-xs font-medium text-fg-muted uppercase tracking-wide">By operation</p>
                {summaryLoading ? (
                  <TableSkeleton rows={3} />
                ) : Object.keys(byOp).length === 0 ? (
                  <p className="py-2 text-xs italic text-fg-muted">
                    No LLM calls yet — operations appear here once edge functions run.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(byOp)
                        .sort(([, a], [, b]) => b - a)
                        .map(([op, cost]) => (
                          <tr key={op} className="border-b border-edge-subtle last:border-0">
                            <td className="py-1.5"><OperationChip operation={op} /></td>
                            <td className="py-1.5 text-right font-mono text-xs tabular-nums">${cost.toFixed(4)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card className="p-4">
                <p className="mb-3 text-xs font-medium text-fg-muted uppercase tracking-wide">By model</p>
                {summaryLoading ? (
                  <TableSkeleton rows={3} />
                ) : Object.keys(byModel).length === 0 ? (
                  <p className="py-2 text-xs italic text-fg-muted">
                    No model usage yet — models appear here once edge functions run.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(byModel)
                        .sort(([, a], [, b]) => b - a)
                        .map(([model, cost]) => (
                          <tr key={model} className="border-b border-edge-subtle last:border-0">
                            <td className="max-w-[160px] truncate py-1.5 font-mono text-xs">{model}</td>
                            <td className="py-1.5 text-right font-mono text-xs tabular-nums">${cost.toFixed(4)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>

            <CostRawLogTable projectId={projectId} />
          </div>
        )}
      </Section>
    </div>
  )
}
