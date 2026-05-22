/**
 * FILE: apps/admin/src/pages/CostPage.tsx
 * PURPOSE: LLM cost discipline console — spend health banner, KPI strip,
 *          URL-driven tabs (Overview / Breakdown / Raw log).
 */

import { useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { usePageCopy } from '../lib/copy'
import { useCostUx, resolveQuickCostTab } from '../lib/costModeUx'
import {
  totalLoggedDetail,
  totalLoggedTooltip,
  spend24hDetail,
  spend24hTooltip,
  spendMonthDetail,
  spendMonthTooltip,
  topDriverDetail,
  topDriverTooltip,
  operationsDetail,
  operationsTooltip,
  modelsDetail,
  modelsTooltip,
  keySourceDetail,
  keySourceTooltip,
} from '../lib/costStatTooltips'
import { costLinks } from '../lib/statCardLinks'
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
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { buildDailySpendSeries, formatShortDay } from '../components/cost/dailySpendSeries'
import { DailySpendChart } from '../components/cost/DailySpendChart'
import { BudgetForecastCard } from '../components/cost/BudgetForecastCard'
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
  const ux = useCostUx()
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

  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId || statsLoading) return
    const quickTab = resolveQuickCostTab(stats)
    if (active !== quickTab) setActive(quickTab)
  }, [ux.isQuickstart, activeProjectId, statsLoading, stats, active, setActive])

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
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'breakdown' as const,
        label: copy?.tabLabels?.breakdown ?? 'Breakdown',
        count: stats.operationsCount > 0 ? stats.operationsCount : undefined,
      },
      {
        id: 'log' as const,
        label: copy?.tabLabels?.log ?? 'Raw log',
        count: stats.totalCalls > 0 ? stats.totalCalls : undefined,
      },
    ],
    [copy?.tabLabels, stats.operationsCount, stats.totalCalls],
  )

  if (!activeProjectId) {
    return (
      <div className="space-y-4" data-testid="mushi-page-cost">
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
        <PageHeader title={copy?.title ?? 'LLM Cost'} />

        <ContainedBlock tone="muted" className="mb-1">
          <p className="text-xs leading-relaxed text-fg-muted">
            {copy?.description ??
              'Track and audit every LLM call across classify, fix, judge, and inventory agents.'}
          </p>
        </ContainedBlock>
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
    <div className="space-y-4" data-testid="mushi-page-cost">
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

      <PageHeader title={copy?.title ?? 'LLM Cost'} projectScope={stats.projectName ?? undefined}>
        {!ux.hideOverviewChrome && (
          <>
            {stats.totalCalls > 0 ? (
              <Badge className="bg-ok-muted text-ok">Telemetry on</Badge>
            ) : (
              <Badge className="bg-warn/10 text-warn">No calls yet</Badge>
            )}
          </>
        )}
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Track and audit every LLM call across classify, fix, judge, and inventory agents.'}
        </p>
      </ContainedBlock>

      <CostStatusBanner stats={stats} onTab={setActive} plainBanner={ux.plainBanner} />

      {!ux.hideTabs && (
      <SegmentedControl
        value={active}
        onChange={setActive}
        options={tabOptions}
        ariaLabel="LLM cost sections"
        size="sm"
      />
      )}

      {!ux.hideCostSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'Spend snapshot'} freshness={{ at: lastFetchedAt, isValidating }}>
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeMeta.description}</p>
        </ContainedBlock>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label={copy?.statLabels?.total ?? 'Total logged'}
              value={fmtSpend(stats.totalSpendUsd)}
              accent={stats.totalSpendUsd > 0 ? 'text-brand' : undefined}
              tooltip={totalLoggedTooltip(stats)}
              detail={totalLoggedDetail(stats)}
              to={costLinks.totalLogged}
            />
            <StatCard
              label={copy?.statLabels?.day24h ?? '24h spend'}
              value={fmtSpend(stats.spend24hUsd)}
              accent={stats.spendSpike24h ? 'text-warn' : stats.spend24hUsd > 0 ? 'text-ok' : undefined}
              tooltip={spend24hTooltip(stats)}
              detail={spend24hDetail(stats)}
              to={costLinks.spend24h}
            />
            <StatCard
              label={copy?.statLabels?.month ?? 'This month'}
              value={fmtSpend(stats.spendMonthUsd)}
              accent="text-brand"
              tooltip={spendMonthTooltip(stats)}
              detail={spendMonthDetail(stats)}
              to={costLinks.spendMonth}
            />
            <StatCard
              label={copy?.statLabels?.topDriver ?? 'Top driver'}
              value={stats.topOperation ? stats.topOperation.split(':')[0] : '—'}
              accent={stats.topOperation ? 'text-info' : undefined}
              tooltip={topDriverTooltip(stats)}
              detail={topDriverDetail(stats)}
              to={costLinks.topDriver}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <StatCard
              label={copy?.statLabels?.operations ?? 'Operations'}
              value={stats.operationsCount}
              tooltip={operationsTooltip(stats)}
              detail={operationsDetail()}
              to={costLinks.operations}
            />
            <StatCard
              label={copy?.statLabels?.models ?? 'Models'}
              value={stats.modelsCount}
              tooltip={modelsTooltip(stats)}
              detail={modelsDetail(stats)}
              to={costLinks.models}
            />
            <StatCard
              label={copy?.statLabels?.keySource ?? 'Key source · 24h'}
              value={stats.byokCalls24h > 0 ? `${stats.byokCalls24h} BYOK` : `${stats.platformKeyCalls24h} platform`}
              accent={stats.byokAnthropicConfigured ? 'text-ok' : 'text-warn'}
              tooltip={keySourceTooltip(stats)}
              detail={keySourceDetail(stats)}
              to={costLinks.keySource}
            />
          </div>
        </div>
      </Section>
      )}

      <div
        role="tabpanel"
        id={`cost-panel-${active}`}
        aria-labelledby={`cost-tab-${active}`}
      >
        {active === 'overview' && (
          <div className="space-y-4">
            {dailySeries.activeDays > 0 ? (
              <Card className="p-4">
                <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
                  <SignalChip tone="neutral" className="uppercase tracking-wide font-medium">
                    Daily spend
                  </SignalChip>
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
            ) : null}
            {dailySeries.activeDays > 0 && (
              <BudgetForecastCard
                projectId={activeProjectId}
                series={dailySeries}
                monthToDateUsd={stats.spendMonthUsd}
                fmtSpend={fmtSpend}
              />
            )}
            {dailySeries.activeDays === 0 ? (
              <ContainedBlock tone="muted" className="p-4 space-y-3">
                <SignalChip tone="neutral" className="uppercase tracking-wide font-medium">
                  Daily spend
                </SignalChip>
                <EmptySectionMessage
                  text="No daily rollups yet."
                  hint="Ingest a report or run a Health smoke test to generate llm_invocations rows."
                />
                <ActionPillRow>
                  <ActionPill to="/health" tone="brand">
                    Open Health
                  </ActionPill>
                </ActionPillRow>
              </ContainedBlock>
            ) : null}
          </div>
        )}

        {active === 'breakdown' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="p-4">
              <SignalChip tone="neutral" className="mb-3 uppercase tracking-wide font-medium">
                By operation
              </SignalChip>
              {summaryLoading ? (
                <TableSkeleton rows={3} />
              ) : Object.keys(byOp).length === 0 ? (
                <EmptySectionMessage
                  text="No LLM calls yet."
                  hint="Operations appear here once edge functions run."
                />
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
              <SignalChip tone="neutral" className="mb-3 uppercase tracking-wide font-medium">
                By model
              </SignalChip>
              {summaryLoading ? (
                <TableSkeleton rows={3} />
              ) : Object.keys(byModel).length === 0 ? (
                <EmptySectionMessage
                  text="No model usage yet."
                  hint="Models appear here once edge functions run."
                />
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
            <ContainedBlock tone="muted" className="mb-3">
              <InlineProof className="border-0 bg-transparent px-0 py-0">
                Primary source:{' '}
                <SignalChip tone="brand" className="font-mono">llm_invocations</SignalChip>
                · merged with legacy{' '}
                <SignalChip tone="neutral" className="font-mono">llm_cost_usd</SignalChip>
                {' '}when searching
              </InlineProof>
            </ContainedBlock>
            <CostRawLogTable projectId={activeProjectId} />
          </Section>
        )}
      </div>
    </div>
  )
}
