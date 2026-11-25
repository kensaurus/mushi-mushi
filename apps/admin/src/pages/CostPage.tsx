/**
 * FILE: apps/admin/src/pages/CostPage.tsx
 * PURPOSE: LLM cost discipline console — spend health banner, KPI strip,
 *          URL-driven tabs (Overview / Breakdown / Raw log).
 */

import { useCallback, useMemo } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { useSearchParams } from 'react-router-dom'
import { usePageCopy } from '../lib/copy'
import { useCostUx, resolveQuickCostTab } from '../lib/costModeUx'
import { useQuickstartLandingTab } from '../lib/useQuickstartTab'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { NextStep } from '../components/NextStep'
import { PageLoadError } from '../components/PageLoadError'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { ResponsiveTable } from '../components/ResponsiveTable'
import {
  Card,
  Section,
  SegmentedControl,
  Badge,
  Btn,
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
import { useReadTimedOut } from '../lib/ciReadTimeout'
import { CiNotChecked } from '../components/ci/CiNotChecked'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { CostRawLogTable } from '../components/cost/CostRawLogTable'
import { CostStatusBanner } from '../components/cost/CostStatusBanner'
import { CostStageGuide } from '../components/cost/CostStageGuide'
import { CostSnapshotStrip } from '../components/cost/CostSnapshotStrip'
import { CostReadout } from '../components/cost/CostReadout'
import { CostUnpricedPanel } from '../components/cost/CostUnpricedPanel'
import { CostVendorCheck } from '../components/cost/CostVendorCheck'
import {
  EMPTY_COST_STATS,
  type CostStats,
  type CostTabId,
  type SummaryRow,
} from '../components/cost/types'
import { OperationChip } from '../components/OperationChip'
import { ModelChip, UsdAmount } from '../components/cost/CostDisplayChips'
import { formatSpendUsd, usesPlatformKeysOnly } from '../lib/costView'

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

/** One money format on the page: 4 decimals (review 2026-11-18). */
const fmtSpend = formatSpendUsd

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
    errorCode: statsErrorCode,
    reload: reloadStats,
    lastFetchedAt,
    isValidating,
  } = usePageData<CostStats>(statsPath)
  const stats = statsData ?? EMPTY_COST_STATS
  // Never an endless skeleton (2026-11-19: Team → AI spend sat on it at 1440): after 20 s the
  // read says "not checked" with one Retry.
  const statsWait = useReadTimedOut(statsLoading && !statsData)

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

  // "N failed calls in 24h → View failures" lands on exactly those rows.
  const viewFailures = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'log')
    next.set('log_status', 'failed')
    next.set('log_since', '24h')
    next.delete('log_page')
    setSearchParams(next, { replace: true, preventScrollReset: true })
  }, [searchParams, setSearchParams])

  // Quick mode opens the posture tab once; links and clicks then win.
  useQuickstartLandingTab({
    enabled: ux.isQuickstart && Boolean(activeProjectId),
    ready: !statsLoading,
    tabParam: param,
    activeTab: active,
    quickTab: resolveQuickCostTab(stats),
    setActiveTab: setActive,
  })

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
    (usesPlatformKeysOnly(stats) ? 1 : 0)

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
      // No counts on the tabs: "Breakdown 10" / "Raw log 65" repeated the
      // Operations and Total logged tiles right above (review 2026-11-18).
      { id: 'breakdown' as const, label: copy?.tabLabels?.breakdown ?? 'Breakdown' },
      { id: 'log' as const, label: copy?.tabLabels?.log ?? 'Raw log' },
    ],
    [copy?.tabLabels],
  )

  if (!activeProjectId) {
    return (
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-cost">
        <PageHeaderBar
          title={copy?.title ?? 'AI spend'}

          helpTitle={copy?.help?.title ?? 'About AI cost tracking'}
          helpWhatIsIt={
            copy?.help?.whatIsIt ??
            'Every LLM call is logged in llm_invocations with token counts and cost_usd. Legacy llm_cost_usd rows are merged into totals.'
          }
          helpUseCases={
            copy?.help?.useCases ?? [
              'Audit which edge function is spending the most',
              'Compare costs across models',
              'Spot a runaway cron from the daily trend',
            ]
          }
          helpHowToUse={
            copy?.help?.howToUse ??
            'Overview shows trend + health. Breakdown groups by operation/model. Raw log lets you search individual calls. Add BYOK in Settings to bill your own AI key.'
          }
        />
        <NextStep
          variant="inline"
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="LLM spend is scoped to the active project — pick mushi-mushi (or your app) in the header switcher."
        />
      </div>
    )
  }

  if (statsLoading && !statsData) {
    if (statsWait.timedOut) {
      return (
        <CiNotChecked
          what="AI spend"
          testId="cost-not-checked"
          onRetry={() => {
            statsWait.restart()
            reloadAll()
          }}
        />
      )
    }
    return <PanelSkeleton rows={6} label="Loading LLM cost" />
  }
  if (statsError) {
    return <PageLoadError error={statsError} code={statsErrorCode} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4" data-testid="mushi-page-cost">
      <PageHeaderBar
        title={copy?.title ?? 'AI spend'}
        projectScope={stats.projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About AI cost tracking'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Every LLM call is logged in llm_invocations with token counts and cost_usd. Legacy llm_cost_usd rows are merged into totals.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Audit which edge function is spending the most',
            'Compare costs across models',
            'Spot a runaway cron from the daily trend',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Overview shows trend + health. Breakdown groups by operation/model. Raw log lets you search individual calls. Add BYOK in Settings to bill your own AI key.'
        }
      >
        {!ux.hideOverviewChrome && (
          <>
            {stats.totalCalls > 0 ? (
              <Badge tone="okSubtle">Telemetry on</Badge>
            ) : (
              <Badge tone="warnSubtle">No calls yet</Badge>
            )}
          </>
        )}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <CostStatusBanner
                stats={stats}
                onTab={setActive}
                onViewFailures={viewFailures}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideCostSnapshot,
            children: (
              <CostSnapshotStrip
                stats={stats}
                fetchedAt={lastFetchedAt}
                isValidating={isValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'Spend snapshot'}
                hint={activeMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            children: <CostStageGuide topPriority={stats.topPriority} topOperation={stats.topOperation} />,
          },
        ]}
      />

      {!ux.hideTabs && (
      <SegmentedControl
        value={active}
        onChange={setActive}
        options={tabOptions}
        ariaLabel="LLM cost sections"
        size="sm"
      />
      )}

      <div
        role="tabpanel"
        id={`cost-panel-${active}`}
        aria-labelledby={`cost-tab-${active}`}
      >
        {active === 'overview' && (
          <div className="space-y-4">
            <CostUnpricedPanel stats={stats} projectId={activeProjectId} onPriced={reloadAll} />
            <CostVendorCheck projectId={activeProjectId} />
            <CostReadout
              stats={stats}
              projectId={activeProjectId}
              fetchedAt={lastFetchedAt}
              isValidating={isValidating}
            />
            {dailySeries.activeDays > 0 ? (
              <Card className="p-4">
                <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
                  {/* A heading like "Month-end forecast" below, not a grey pill. */}
                  <h3 className="text-xs font-semibold text-fg">Daily spend</h3>
                  <Btn to="/billing" size="sm" variant="ghost">Compare to plan usage</Btn>
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
                fmtSpend={fmtSpend}
              />
            )}
            {dailySeries.activeDays === 0 ? (
              <ContainedBlock tone="muted" className="p-4 space-y-3">
                <h3 className="text-xs font-semibold text-fg">Daily spend</h3>
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
          <div className="space-y-4">
          <CostUnpricedPanel stats={stats} projectId={activeProjectId} onPriced={reloadAll} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-xs font-semibold text-fg">By operation</h3>
              {summaryLoading ? (
                <TableSkeleton rows={3} />
              ) : Object.keys(byOp).length === 0 ? (
                <EmptySectionMessage
                  text="No LLM calls yet."
                  hint="Operations appear here once edge functions run."
                />
              ) : (
                <ResponsiveTable ariaLabel="Cost by operation">
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
                            <UsdAmount value={cost} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                </ResponsiveTable>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-xs font-semibold text-fg">By model</h3>
              {summaryLoading ? (
                <TableSkeleton rows={3} />
              ) : Object.keys(byModel).length === 0 ? (
                <EmptySectionMessage
                  text="No model usage yet."
                  hint="Models appear here once edge functions run."
                />
              ) : (
                <ResponsiveTable ariaLabel="Cost by model">
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(byModel)
                      .sort(([, a], [, b]) => b - a)
                      .map(([model, cost]) => (
                        <tr key={model} className="border-b border-edge-subtle last:border-0">
                          <td className="max-w-40 truncate py-1.5">
                            <ModelChip model={model} />
                          </td>
                          <td className="py-1.5 text-right">
                            <UsdAmount value={cost} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                </ResponsiveTable>
              )}
            </Card>
          </div>
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
