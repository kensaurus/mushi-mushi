/**
 * FILE: apps/admin/src/pages/CostPage.tsx
 * PURPOSE: LLM cost discipline console — spend health banner, KPI strip,
 *          URL-driven tabs (Overview / Breakdown / Raw log).
 */

import { useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { usePageCopy } from '../lib/copy'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { SetupNudge } from '../components/SetupNudge'
import {
  PageHeader,
  PageHelp,
  Card,
  Section,
  StatCard,
  SegmentedControl,
  Badge,
  Btn,
  ErrorAlert,
} from '../components/ui'
import { buildDailySpendSeries, formatShortDay } from '../components/cost/dailySpendSeries'
import { DailySpendChart } from '../components/cost/DailySpendChart'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { CostRawLogTable } from '../components/cost/CostRawLogTable'
import { CostStatusBanner } from '../components/cost/CostStatusBanner'
import {
  EMPTY_COST_STATS,
  type CostStats,
  type CostTabId,
  type SummaryRow,
} from '../components/cost/types'
import { OperationChip } from '../components/OperationChip'
import { ModelChip, UsdAmount } from '../components/cost/CostDisplayChips'

const TABS: Array<{ id: CostTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Daily trend, month-to-date spend, and quick health signals.',
  },
  {
    id: 'breakdown',
    label: 'Breakdown',
    description: 'Roll up spend by edge function (operation) and provider model.',
  },
  {
    id: 'log',
    label: 'Raw log',
    description: 'Paginated llm_invocations rows — search, sort, and audit individual calls.',
  },
]

function isTabId(value: string | null): value is CostTabId {
  return TABS.some((t) => t.id === value)
}

function listRows<T>(payload: T[] | null | undefined): T[] {
  return Array.isArray(payload) ? payload : []
}

function fmtSpend(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

export function CostPage() {
  const copy = usePageCopy('/cost')
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()

  const param = searchParams.get('tab')
  const active: CostTabId = isTabId(param) ? param : 'overview'
  const activeMeta = TABS.find((t) => t.id === active) ?? TABS[0]

  const statsPath = activeProjectId
    ? `/v1/admin/costs/stats?project_id=${activeProjectId}`
    : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt,
    isValidating,
  } = usePageData<CostStats>(statsPath)
  const stats = statsData ?? EMPTY_COST_STATS

  const summaryPath = activeProjectId
    ? `/v1/admin/costs/summary?project_id=${activeProjectId}`
    : null
  const { data: summaryData, loading: summaryLoading, reload: reloadSummary } =
    usePageData<SummaryRow[]>(summaryPath, { deps: [activeProjectId] })

  const summary = listRows(summaryData)

  const reloadAll = useCallback(() => {
    reloadStats()
    reloadSummary()
  }, [reloadStats, reloadSummary])

  useRealtimeReload(['llm_invocations'], reloadAll)

  const setActive = useCallback(
    (id: CostTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const { byOp, byModel, dailySeries } = useMemo(() => {
    const op: Record<string, number> = {}
    const model: Record<string, number> = {}
    const day: Record<string, number> = {}

    for (const s of summary) {
      const cost = Number(s.total_cost_usd)
      op[s.operation] = (op[s.operation] ?? 0) + cost
      model[s.model] = (model[s.model] ?? 0) + cost
      const dayKey = s.day?.slice(0, 10) ?? 'unknown'
      if (dayKey !== 'unknown') day[dayKey] = (day[dayKey] ?? 0) + cost
    }

    return {
      byOp: op,
      byModel: model,
      dailySeries: buildDailySpendSeries(day),
    }
  }, [summary])

  const dailyBarTitles = useMemo(
    () =>
      dailySeries.days.map((d, i) => {
        const label = formatShortDay(d) ?? d
        const v = dailySeries.values[i]
        return v > 0 ? `${label}: ${fmtSpend(v)}` : `${label}: no spend`
      }),
    [dailySeries.days, dailySeries.values],
  )

  const criticalCount =
    (stats.totalCalls === 0 ? 1 : 0) +
    (stats.spendSpike24h ? 1 : 0) +
    stats.failedCalls24h +
    (!stats.byokAnthropicConfigured && stats.platformKeyCalls24h > 0 ? 1 : 0)

  usePublishPageContext({
    route: '/cost',
    title: `${activeMeta.label} · LLM Cost`,
    summary: activeMeta.description,
    filters: { tab: active, project_id: activeProjectId ?? undefined },
    criticalCount,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'breakdown' as const,
        label: 'Breakdown',
        count: stats.operationsCount > 0 ? stats.operationsCount : undefined,
      },
      {
        id: 'log' as const,
        label: 'Raw log',
        count: stats.totalCalls > 0 ? stats.totalCalls : undefined,
      },
    ],
    [stats.operationsCount, stats.totalCalls],
  )

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={copy?.title ?? 'LLM Cost'}
          description={
            copy?.description ??
            'Track and audit every LLM call across classify, fix, judge, and inventory agents.'
          }
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="LLM spend is scoped to the active project — pick mushi-mushi (or your app) in the header switcher."
        />
      </div>
    )
  }

  if (statsLoading && !statsData) {
    return <PanelSkeleton rows={6} label="Loading LLM cost" />
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load cost stats: ${statsError}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'LLM Cost'}
        description={
          copy?.description ??
          'Track and audit every LLM call across classify, fix, judge, and inventory agents.'
        }
        projectScope={stats.projectName ?? undefined}
      >
        {stats.totalCalls > 0 ? (
          <Badge className="bg-ok-muted text-ok">Telemetry on</Badge>
        ) : (
          <Badge className="bg-warn/10 text-warn">No calls yet</Badge>
        )}
      </PageHeader>

      <CostStatusBanner stats={stats} onTab={setActive} />

      <SegmentedControl
        value={active}
        onChange={setActive}
        options={tabOptions}
        ariaLabel="LLM cost sections"
        size="sm"
      />

      <Section title="Spend snapshot" freshness={{ at: lastFetchedAt, isValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Total logged"
            value={fmtSpend(stats.totalSpendUsd)}
            accent={stats.totalSpendUsd > 0 ? 'text-brand' : undefined}
            hint={`${stats.invocationCount} invocations${stats.ledgerCount > 0 ? ` + ${stats.ledgerCount} legacy` : ''}`}
          />
          <StatCard
            label="24h spend"
            value={fmtSpend(stats.spend24hUsd)}
            accent={stats.spendSpike24h ? 'text-warn' : stats.spend24hUsd > 0 ? 'text-ok' : undefined}
            hint={`${stats.calls24h} calls · avg ${fmtSpend(stats.avgCostPerCall24h)}/call`}
          />
          <StatCard
            label="This month"
            value={fmtSpend(stats.spendMonthUsd)}
            accent="text-brand"
            hint={`7d: ${fmtSpend(stats.spend7dUsd)} · 30d: ${fmtSpend(stats.spend30dUsd)}`}
          />
          <StatCard
            label="Top driver"
            value={stats.topOperation ? stats.topOperation.split(':')[0] : '—'}
            accent={stats.topOperation ? 'text-info' : undefined}
            hint={
              stats.topOperation
                ? `${fmtSpend(stats.topOperationUsd)} · ${stats.topModel ?? 'no model'}`
                : 'Runs classify or fix to populate'
            }
          />
        </div>
      </Section>

      <PageHelp
        title={copy?.help?.title ?? 'About AI cost tracking'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Every LLM call is logged in llm_invocations with token counts and cost_usd. Legacy llm_cost_usd rows are merged into totals.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Audit which edge function is spending the most',
            'Compare costs across models',
            'Spot a runaway cron from the daily trend',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Overview shows trend + health. Breakdown groups by operation/model. Raw log lets you search individual calls. Add BYOK in Settings to bill your own Anthropic key.'
        }
      />

      <div
        role="tabpanel"
        id={`cost-panel-${active}`}
        aria-labelledby={`cost-tab-${active}`}
      >
        {active === 'overview' && (
          <div className="space-y-4">
            {dailySeries.activeDays > 0 ? (
              <Card className="p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">Daily spend</p>
                  <Link to="/billing">
                    <Btn size="sm" variant="ghost">Compare to plan usage</Btn>
                  </Link>
                </div>
                <DailySpendChart
                  series={dailySeries}
                  barTitles={dailyBarTitles}
                  fmtSpend={fmtSpend}
                />
              </Card>
            ) : (
              <Card className="p-4">
                <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">Daily spend</p>
                <p className="mt-2 text-2xs text-fg-muted">
                  No daily rollups yet — ingest a report or run a Health smoke test to generate llm_invocations rows.
                </p>
                <Link to="/health" className="mt-3 inline-block">
                  <Btn size="sm" variant="ghost">Open Health</Btn>
                </Link>
              </Card>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Operations"
                value={stats.operationsCount}
                hint="Distinct function:stage pairs in 30d window"
              />
              <StatCard
                label="Models"
                value={stats.modelsCount}
                hint={stats.topModel ? `Top: ${stats.topModel}` : 'Models appear after first call'}
              />
              <StatCard
                label="Key source · 24h"
                value={stats.byokCalls24h > 0 ? `${stats.byokCalls24h} BYOK` : `${stats.platformKeyCalls24h} platform`}
                accent={stats.byokAnthropicConfigured ? 'text-ok' : 'text-warn'}
                hint={stats.byokAnthropicConfigured ? 'Anthropic BYOK configured' : 'Add BYOK in Settings → LLM keys'}
              />
            </div>
          </div>
        )}

        {active === 'breakdown' && (
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
                          <td className="py-1.5">
                            <OperationChip operation={op} />
                          </td>
                          <td className="py-1.5 text-right">
                            <UsdAmount value={cost} digits={5} />
                          </td>
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
                          <td className="max-w-[160px] truncate py-1.5">
                            <ModelChip model={model} />
                          </td>
                          <td className="py-1.5 text-right">
                            <UsdAmount value={cost} digits={5} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        )}

        {active === 'log' && activeProjectId && (
          <Section title="Invocation log">
            <p className="mb-3 text-2xs text-fg-muted">
              Primary source: llm_invocations · merged with legacy llm_cost_usd when searching
            </p>
            <CostRawLogTable projectId={activeProjectId} />
          </Section>
        )}
      </div>
    </div>
  )
}
