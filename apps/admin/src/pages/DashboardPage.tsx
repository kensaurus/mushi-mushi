/**
 * FILE: apps/admin/src/pages/DashboardPage.tsx
 * PURPOSE: 14-day operational view of bug intake, LLM cost, auto-fix
 *          pipeline, integration health, and the triage queue. Tab shell
 *          (Overview | Loop | Metrics | Health) + stats banner/KPI strip.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import type { ChartEvent } from '../lib/apiSchemas'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { useMilestoneCelebration } from '../lib/useMilestoneCelebration'
import { Confetti } from '../components/Confetti'
import {
  PageHeader,
  PageHelp,
  Btn,
  ErrorAlert,
  FreshnessPill,
  Section,
  StatCard,
  SegmentedControl,
  Badge,
  Card,
} from '../components/ui'
import { DashboardSkeleton } from '../components/skeletons/DashboardSkeleton'
import { SetupChecklist } from '../components/SetupChecklist'
import { GettingStartedEmpty } from '../components/dashboard/GettingStartedEmpty'
import { FirstReportHero } from '../components/dashboard/FirstReportHero'
import { QuotaBanner } from '../components/dashboard/QuotaBanner'
import { HeroIntro } from '../components/dashboard/HeroIntro'
import { PdcaCockpit } from '../components/dashboard/PdcaCockpit'
import { PdcaFlow } from '../components/pdca-flow/PdcaFlow'
import { LivePdcaPipeline } from '../components/dashboard/LivePdcaPipeline'
import { KpiRow } from '../components/dashboard/KpiRow'
import { ChartsRow } from '../components/dashboard/ChartsRow'
import { TriageAndFixRow } from '../components/dashboard/TriageAndFixRow'
import { InsightsRow } from '../components/dashboard/InsightsRow'
import { QaCoverageTile } from '../components/dashboard/QaCoverageTile'
import { PlatformHealthTile } from '../components/dashboard/PlatformHealthTile'
import { DashboardStatusBanner } from '../components/dashboard/DashboardStatusBanner'
import {
  EMPTY_DASHBOARD_STATS,
  type DashboardStats,
  type DashboardTabId,
} from '../components/dashboard/DashboardStatsTypes'
import type { DashboardData } from '../components/dashboard/types'
import type { PdcaStageId } from '../lib/pdca'
import { usePageCopy } from '../lib/copy'
import { useDashboardUx, resolveQuickDashboardTab } from '../lib/dashboardModeUx'
import {
  backlogDetail,
  backlogTooltip,
  fixesDetail,
  fixesTooltip,
  focusDetail,
  focusTooltip,
  reports14dDetail,
  reports14dTooltip,
} from '../lib/statTooltips/dashboard'
import { dashboardLinks, statLink } from '../lib/statCardLinks'
import { PageHero } from '../components/PageHero'

const DASHBOARD_TABS: Array<{ id: DashboardTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Pipeline strip, setup checklist, and the fastest path to your next action.',
  },
  {
    id: 'loop',
    label: 'Loop',
    description: 'Interactive Plan → Do → Check → Act canvas with live counts and activity.',
  },
  {
    id: 'metrics',
    label: 'Metrics',
    description: '14-day KPIs, intake charts, LLM cost, triage queue, and component hotspots.',
  },
  {
    id: 'health',
    label: 'Health',
    description: 'Integration probes and QA story coverage for the active project.',
  },
]

function isDashboardTab(value: string | null): value is DashboardTabId {
  return DASHBOARD_TABS.some((t) => t.id === value)
}

function inferRunningStage(data: DashboardData): PdcaStageId | null {
  const activity = data.activity ?? []
  const recent = activity[0]
  if (!recent) return null
  const ageMs = Date.now() - new Date(recent.at).getTime()
  if (ageMs > 60_000) return null
  if (recent.kind === 'report') return 'plan'
  if (recent.kind === 'fix') return 'do'
  return null
}

function focusAccent(stage: string | null): string | undefined {
  switch (stage) {
    case 'plan':
      return 'text-danger'
    case 'do':
      return 'text-warn'
    case 'check':
      return 'text-info'
    case 'act':
      return 'text-brand'
    default:
      return 'text-ok'
  }
}

export function DashboardPage() {
  const { data, loading, error, isValidating, lastFetchedAt, reload } =
    usePageData<DashboardData>('/v1/admin/dashboard')
  const chartEventsQuery = usePageData<{ events: ChartEvent[] }>(
    '/v1/admin/chart-events?kinds=deploy,cron,byok',
  )
  const chartEvents = chartEventsQuery.data?.events ?? []
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const toast = useToast()
  const navigate = useNavigate()
  const [showFullDashboard, setShowFullDashboard] = useState(
    () => searchParams.get('tab') === 'metrics',
  )
  const copy = usePageCopy('/dashboard')
  const ux = useDashboardUx()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: DashboardTabId = isDashboardTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = DASHBOARD_TABS.find((t) => t.id === activeTab) ?? DASHBOARD_TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<DashboardStats>('/v1/admin/dashboard/stats')
  const stats = statsData ?? EMPTY_DASHBOARD_STATS

  const reloadAll = useCallback(() => {
    reloadStats()
    reload()
    setup.reload()
  }, [reloadStats, reload, setup])

  const setActiveTab = useCallback(
    (id: DashboardTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const peekMetrics = useCallback(() => {
    setShowFullDashboard(true)
    setActiveTab('metrics')
  }, [setActiveTab])

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading || showFullDashboard) return
    const quickTab = resolveQuickDashboardTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab, showFullDashboard])

  const isEmpty = !data || data.empty
  const realtimeEnabled = !loading && !error && !!stats.hasAnyProject
  const { channelState } = useRealtimeReload(
    ['reports', 'fix_attempts', 'fix_events', 'fix_dispatch_jobs'],
    reloadAll,
    { debounceMs: 1000, enabled: realtimeEnabled },
  )

  const onFirstMergedFix = useCallback(() => {
    toast.success(
      'Your first auto-fix was merged 🎉',
      'Mushi just closed a full PDCA loop end-to-end. Want to see the merged PR?',
      { label: 'View merged fixes', onClick: () => navigate('/fixes') },
    )
  }, [toast, navigate])
  const { triggerKey: confettiKey } = useMilestoneCelebration(
    'first-merged-fix',
    setup.activeProject?.merged_fix_count ?? null,
    { onFire: onFirstMergedFix },
  )

  const dashProjectName = setup.activeProject?.project_name ?? stats.projectName
  const dashCounts = data?.counts
  const dashFix = data?.fixSummary
  const dashSummary = loading
    ? 'Loading dashboard…'
    : statsError
      ? 'Stats unavailable'
      : !stats.hasAnyProject
        ? 'Create a project on Setup'
        : !stats.setupDone
          ? `Setup ${stats.requiredComplete}/${stats.requiredTotal} — finish ingest to unlock metrics`
          : stats.openBacklog > 0
            ? `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting to triage`
            : stats.fixesFailed > 0
              ? `${stats.fixesFailed} failed fix${stats.fixesFailed === 1 ? '' : 'es'} need retry`
              : isEmpty
                ? 'Pipeline wired — waiting for first report'
                : dashCounts
                  ? `${dashCounts.openBacklog} to triage · ${dashFix?.inProgress ?? 0} fix${(dashFix?.inProgress ?? 0) === 1 ? '' : 'es'} in flight${dashFix?.failed ? ` · ${dashFix.failed} failed` : ''}`
                  : `${stats.reports14d} reports in 14d`

  usePublishPageContext({
    route: '/dashboard',
    title: dashProjectName ? `Dashboard · ${dashProjectName}` : 'Dashboard',
    summary: `${activeTabMeta.label} · ${dashSummary}`,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.openBacklog || dashCounts?.openBacklog || 0,
    questions: [
      (stats.openBacklog || dashCounts?.openBacklog || 0) > 0
        ? `What's in my backlog of ${stats.openBacklog || dashCounts!.openBacklog} reports right now?`
        : 'Is the PDCA loop healthy this week?',
      'Where is the bottleneck in the PDCA loop?',
      'What changed in the last 24 hours I should know about?',
    ],
    actions: [
      {
        id: 'reload-dashboard',
        label: 'Refresh dashboard',
        hint: 'Re-fetch stats and dashboard payload',
        run: () => { void reloadAll() },
      },
    ],
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'loop' as const,
        label: copy?.tabLabels?.loop ?? 'Loop',
        count: stats.focusStage ? 1 : undefined,
      },
      {
        id: 'metrics' as const,
        label: copy?.tabLabels?.metrics ?? 'Metrics',
        count: stats.openBacklog > 0 ? stats.openBacklog : stats.reports14d > 0 ? stats.reports14d : undefined,
      },
      {
        id: 'health' as const,
        label: copy?.tabLabels?.health ?? 'Health',
        count: stats.integrationIssues > 0 ? stats.integrationIssues : undefined,
      },
    ],
    [stats, copy?.tabLabels],
  )

  if ((loading && !data) || (statsLoading && !statsData)) return <DashboardSkeleton />
  if (error) return <ErrorAlert message={error} onRetry={reloadAll} />
  if (statsError) return <ErrorAlert message={`Failed to load dashboard stats: ${statsError}`} onRetry={reloadAll} />

  const counts = data?.counts
  const fixSummary = data?.fixSummary
  const reportsByDay = data?.reportsByDay ?? []
  const llmByDay = data?.llmByDay ?? []
  const activity = data?.activity ?? []
  const lastReportAt = activity.find((a) => a.kind === 'report')?.at ?? null
  const projectName = setup.activeProject?.project_name ?? stats.projectName
  const dashboardProjects = data?.projects ?? []
  const dashDescription =
    copy?.description ??
    (dashboardProjects.length > 1
      ? `Workspace overview · ${dashboardProjects.length} projects`
      : projectName
        ? `Your loop on ${projectName}`
        : undefined)
  const sdkInstalled = setup.activeProject ? !setup.isStepIncomplete('sdk_installed') : false
  const showFirstReportHero =
    !!setup.activeProject && sdkInstalled && setup.activeProject.report_count === 0
  const setupIncomplete =
    !!setup.activeProject &&
    !setup.selectors.done &&
    setup.selectors.required_complete < setup.selectors.required_total
  const renderFullDashboard = !setupIncomplete || showFullDashboard
  const metricsCounts =
    counts ?? {
      reports14d: stats.reports14d,
      openBacklog: stats.openBacklog,
      fixesTotal: stats.fixesInProgress + stats.fixesFailed,
      openPrs: stats.openPrs,
      llmCalls14d: stats.llmCalls14d,
      llmTokens14d: 0,
      llmFailures14d: stats.llmFailures14d,
    }
  const metricsFixSummary =
    fixSummary ?? {
      total: stats.fixesInProgress + stats.fixesFailed,
      completed: 0,
      failed: stats.fixesFailed,
      inProgress: stats.fixesInProgress,
      openPrs: stats.openPrs,
    }
  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : !stats.setupDone
        ? 'warn'
        : stats.openBacklog > 0 || stats.fixesFailed > 0
          ? 'danger'
          : stats.integrationIssues > 0
            ? 'warn'
            : !stats.hasData
              ? 'info'
              : 'ok'

  return (
    <div className="space-y-4">
      <Confetti triggerKey={confettiKey} />

      <PageHelp
        title={copy?.help?.title ?? 'About the Dashboard'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Tabbed workspace view: Overview for next actions, Loop for PDCA canvas, Metrics for 14-day charts, Health for probes.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Read the status banner first — it surfaces backlog, failures, and integration issues',
            'Jump to Loop when you need the interactive stage canvas',
            'Use Metrics when comparing intake vs fix throughput week over week',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Click KPI tiles or tab badges to drill in. Green banner means nothing urgent is blocking the loop.'
        }
      />

      <PageHeader title={copy?.title ?? 'Dashboard'} projectScope={projectName ?? undefined} description={dashDescription}>
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'danger'
                ? 'bg-danger/10 text-danger'
                : bannerSeverity === 'warn'
                  ? 'bg-warn/10 text-warn'
                  : 'bg-info/10 text-info'
          }
        >
          {bannerSeverity === 'ok'
            ? 'HEALTHY'
            : bannerSeverity === 'danger'
              ? 'ACTION'
              : bannerSeverity === 'warn'
                ? 'ATTENTION'
                : stats.hasAnyProject
                  ? 'SETUP'
                  : 'START'}
        </Badge>
        <FreshnessPill
          at={statsFetchedAt ?? lastFetchedAt}
          isValidating={statsValidating || isValidating}
          channel={channelState}
        />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || isValidating}>
          Refresh
        </Btn>
        <Link to="/reports" className="text-xs text-brand hover:text-brand-hover">
          View all reports →
        </Link>
      </PageHeader>

      <DashboardStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating || isValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
        <SegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          options={tabOptions}
          ariaLabel="Dashboard sections"
          size="sm"
        />
      )}

      {!ux.hideLoopSnapshot && (
        <Section title={copy?.sections?.snapshot ?? 'LOOP SNAPSHOT'} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeTabMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.backlog ?? 'Backlog'}
            value={stats.openBacklog}
            accent={stats.openBacklog > 0 ? 'text-danger' : 'text-ok'}
            tooltip={backlogTooltip(stats)}
            detail={backlogDetail(stats)}
            to={dashboardLinks.backlog}
          />
          <StatCard
            label={copy?.statLabels?.reports ?? 'Reports 14d'}
            value={stats.reports14d}
            accent={stats.reports14d > 0 ? 'text-brand' : undefined}
            tooltip={reports14dTooltip(stats)}
            detail={reports14dDetail(stats)}
            to={dashboardLinks.reports14d}
          />
          <StatCard
            label={copy?.statLabels?.fixes ?? 'Fixes'}
            value={stats.fixesInProgress}
            accent={stats.fixesFailed > 0 ? 'text-danger' : stats.fixesInProgress > 0 ? 'text-warn' : undefined}
            tooltip={fixesTooltip(stats)}
            detail={fixesDetail(stats)}
            to={dashboardLinks.fixes}
          />
          <StatCard
            label={copy?.statLabels?.focus ?? 'Focus'}
            value={stats.focusLabel ?? '—'}
            accent={focusAccent(stats.focusStage)}
            tooltip={focusTooltip(stats)}
            detail={focusDetail(stats)}
            to={statLink(dashboardLinks.focus, stats)}
          />
        </div>
      </Section>
      )}

      {activeTab === 'overview' && (
        <>
          {isEmpty ? (
            <GettingStartedEmpty embedded />
          ) : (
            <>
              <LivePdcaPipeline
                projectId={setup.activeProject?.project_id}
                pdcaStages={data!.pdcaStages}
                onDemoReportSent={reloadAll}
              />

              {showFirstReportHero && setup.activeProject && (
                <FirstReportHero
                  projectId={setup.activeProject.project_id}
                  projectName={setup.activeProject.project_name}
                  onReportSent={reloadAll}
                />
              )}

              {!showFirstReportHero && data!.pdcaStages && data!.pdcaStages.length > 0 && !ux.hideOverviewChrome && (
                <HeroIntro
                  stages={data!.pdcaStages}
                  focusStage={data!.focusStage}
                  projectName={projectName}
                  lastReportAt={lastReportAt}
                />
              )}

              {!ux.hideOverviewChrome && (
              <PageHero
                scope="dashboard"
                title="Bug-fix loop"
                kicker="Start here"
                decide={{
                  label: stats.bottleneck ?? (stats.setupDone ? 'Loop healthy' : 'Finish setup'),
                  metric: stats.focusLabel ? `${stats.focusLabel} stage` : undefined,
                  summary: stats.setupDone
                    ? stats.hasData
                      ? 'Reports are entering the loop — use Loop tab for the canvas or Metrics for charts.'
                      : 'Pipeline wired — send a test report from Setup to populate charts.'
                    : 'Complete project, key, SDK, and first report before metrics unlock.',
                  severity: bannerSeverity === 'ok' ? 'ok' : bannerSeverity === 'danger' ? 'crit' : 'info',
                }}
                verify={{
                  label: 'Live reload',
                  detail: 'Dashboard stats refresh when reports or fixes change via webhook.',
                }}
              />
              )}
            </>
          )}

          {setup.activeProject && (
            <SetupChecklist
              project={setup.activeProject}
              mode="banner"
              onRefresh={setup.reload}
              adminEndpointHost={setup.data?.admin_endpoint_host ?? null}
            />
          )}

          {!isEmpty && setupIncomplete && !showFullDashboard && (
            <div className="flex items-center justify-between rounded-md border border-edge-subtle bg-surface-raised/30 px-3 py-2.5">
              <p className="text-xs text-fg-muted">
                Finish setup above to unlock Metrics tab. You can peek now if you like.
              </p>
              <Btn size="sm" variant="ghost" onClick={peekMetrics}>
                Show full metrics
              </Btn>
            </div>
          )}

        </>
      )}

      {activeTab === 'loop' && (
        <>
          {isEmpty || !data!.pdcaStages?.length ? (
            <Card className="p-4">
              <p className="text-xs font-medium text-fg">Loop canvas unlocks after first report</p>
              <p className="mt-1 text-2xs text-fg-muted">
                Send a test report from Setup — the Plan → Do → Check → Act canvas needs live stage counts.
              </p>
              <Link to="/onboarding?tab=verify" className="mt-3 inline-block">
                <Btn size="sm" variant="ghost">Send test report</Btn>
              </Link>
            </Card>
          ) : (
            <>
              <div className="hidden sm:block">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                    Loop status — Plan, Do, Check, Act
                  </h2>
                  <span className="text-2xs text-fg-faint">Plan → Do → Check → Act (loops back)</span>
                </div>
                <PdcaFlow
                  variant="live"
                  stages={data!.pdcaStages}
                  focusStage={data!.focusStage}
                  runningStage={inferRunningStage(data!)}
                  activity={activity}
                  interactive
                  showActionPanel
                  showActivityLog
                  ariaLabel="Live PDCA loop — live counts per stage with the current bottleneck highlighted. Click a stage to inspect it."
                />
              </div>
              <div className="sm:hidden">
                <PdcaCockpit stages={data!.pdcaStages} focusStage={data!.focusStage} />
              </div>
              {fixSummary && counts && (
                <TriageAndFixRow triageQueue={data!.triageQueue ?? []} fixSummary={fixSummary} />
              )}
            </>
          )}
        </>
      )}

      {activeTab === 'metrics' && (
        <>
          {!renderFullDashboard ? (
            <Card className="p-4">
              <p className="text-xs font-medium text-warn">Setup incomplete — metrics gated</p>
              <p className="mt-1 text-2xs text-fg-muted">
                Finish required setup steps on Overview, or peek metrics now.
              </p>
              <Btn size="sm" variant="ghost" className="mt-3" onClick={peekMetrics}>
                Show metrics anyway
              </Btn>
            </Card>
          ) : (
            <>
              {ux.hideTabs && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-edge-subtle bg-surface-raised/30 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium text-fg">Metrics preview</p>
                    <p className="text-2xs text-fg-muted">
                      {setupIncomplete
                        ? 'Preview while setup finishes — charts fill in after first ingest.'
                        : stats.hasData
                          ? '14-day intake, auto-fix throughput, and LLM activity.'
                          : 'Waiting for first report — tiles update as soon as ingest is live.'}
                    </p>
                  </div>
                  <Btn size="sm" variant="ghost" onClick={() => setActiveTab('overview')}>
                    Back to overview
                  </Btn>
                </div>
              )}

              {setupIncomplete && (
                <Card className="p-4 border-warn/30 bg-warn/5">
                  <p className="text-xs font-medium text-warn">
                    Setup {stats.requiredComplete}/{stats.requiredTotal} — metrics preview
                  </p>
                  <p className="mt-1 text-2xs text-fg-muted">
                    Finish the checklist on Overview to unlock live charts. These tiles use workspace stats until ingest lands.
                  </p>
                  <Link to="/onboarding?tab=steps" className="mt-3 inline-block">
                    <Btn size="sm" variant="ghost">Continue setup</Btn>
                  </Link>
                </Card>
              )}

              {!stats.hasData && isEmpty && !setupIncomplete && (
                <Card className="p-4">
                  <p className="text-xs font-medium text-info">No metrics yet</p>
                  <p className="mt-1 text-2xs text-fg-muted">
                    Charts populate after the first report lands — usually within seconds of SDK ingest.
                  </p>
                  <Link to="/onboarding?tab=verify" className="mt-3 inline-block">
                    <Btn size="sm" variant="ghost">Send test report</Btn>
                  </Link>
                </Card>
              )}

              <QuotaBanner />
              <KpiRow
                counts={metricsCounts}
                fixSummary={metricsFixSummary}
                reportsByDay={reportsByDay}
                llmByDay={llmByDay}
              />
              <ChartsRow
                reportsByDay={reportsByDay}
                llmByDay={llmByDay}
                totalLlmCalls={metricsCounts.llmCalls14d}
                chartEvents={chartEvents}
              />
              {!isEmpty && fixSummary && (
                <TriageAndFixRow triageQueue={data!.triageQueue ?? []} fixSummary={fixSummary} />
              )}
              {!isEmpty && (
                <InsightsRow
                  topComponents={data!.topComponents ?? []}
                  integrations={data!.integrations ?? []}
                  activity={activity}
                />
              )}
            </>
          )}
        </>
      )}

      {activeTab === 'health' && (
        <>
          {!activeProjectId ? (
            <Card className="p-4">
              <p className="text-xs font-medium text-info">Select a project</p>
              <p className="mt-1 text-2xs text-fg-muted">
                Health probes and QA coverage are scoped to the active project in the header switcher.
              </p>
              <Link to="/projects" className="mt-3 inline-block">
                <Btn size="sm" variant="ghost">Open projects</Btn>
              </Link>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <PlatformHealthTile projectId={activeProjectId} />
              <QaCoverageTile projectId={activeProjectId} />
            </div>
          )}
          {!isEmpty && (data!.integrations ?? []).length > 0 && (
            <InsightsRow
              topComponents={[]}
              integrations={data!.integrations ?? []}
              activity={[]}
            />
          )}
        </>
      )}
    </div>
  )
}
