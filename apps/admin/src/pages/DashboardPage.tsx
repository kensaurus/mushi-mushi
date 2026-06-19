/**
 * FILE: apps/admin/src/pages/DashboardPage.tsx
 * PURPOSE: 14-day operational view of bug intake, LLM cost, auto-fix
 *          pipeline, integration health, and the triage queue. Page-level
 *          orchestration only — data load + composition. Each row is a
 *          dedicated subcomponent in components/dashboard/* so they can
 *          evolve independently and stay below the 30-line-function limit.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import type { ChartEvent } from '../lib/apiSchemas'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { useMilestoneCelebration } from '../lib/useMilestoneCelebration'
import { Confetti } from '../components/Confetti'
import { Btn, ErrorAlert, FreshnessPill } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
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
import { SdkUpgradeBanner } from '../components/dashboard/SdkUpgradeBanner'
import type { DashboardData } from '../components/dashboard/types'
import type { PdcaStageId } from '../lib/pdca'
import { usePageCopy } from '../lib/copy'
import { useDashboardUx } from '../lib/dashboardModeUx'
import { deriveDashboardInsight } from '../lib/dashboardExplainer'

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

export function DashboardPage() {
  const { data, loading, error, isValidating, lastFetchedAt, reload } = usePageData<DashboardData>('/v1/admin/dashboard')
  // Wave T.5.8b: chart annotations. Fetched lazily alongside the main
  // dashboard payload — we swallow errors because annotations are a
  // garnish, not critical data.
  const chartEventsQuery = usePageData<{ events: ChartEvent[] }>(
    '/v1/admin/chart-events?kinds=deploy,cron,byok',
  )
  const chartEvents = chartEventsQuery.data?.events ?? []
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const toast = useToast()
  const navigate = useNavigate()
  const [showFullDashboard, setShowFullDashboard] = useState(false)
  const copy = usePageCopy('/dashboard')
  const { isAdvanced, hideOverviewChrome } = useDashboardUx()

  // First-fix-merged celebration: when `merged_fix_count` flips 0 → 1 we
  // fire a confetti burst + a toast with a CTA to the merged PR. This is the
  // single most important peak-end moment in the whole loop — it's the proof
  // that Mushi closed a PDCA cycle on the user's project. (Round 2 polish.)
  // SPA-route via `navigate` rather than `window.location.assign` — the
  // latter discards in-memory state (toast queue, scroll, focus) on what
  // should be a celebratory in-app jump.
  // Live-pulse the dashboard via Supabase Realtime. Previously a 15s poll,
  // now event-driven: when a report lands the queue ticks immediately and
  // the PDCA pipeline can pulse the right stage. A 1s debounce avoids
  // thrashing when a burst of webhooks (push + pr + check_run) for the
  // same fix land in the same second. Dashboard reloads are cheap because
  // the backend caches the aggregate for 10s server-side.
  const realtimeEnabled = !loading && !error && !!data && !data.empty
  const { channelState } = useRealtimeReload(
    ['reports', 'fix_attempts', 'fix_events', 'fix_dispatch_jobs'],
    reload,
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

  // Publish context so the browser tab title + favicon badge track the
  // dashboard's live state (backlog / in-flight fixes / LLM failures).
  // Called unconditionally — hooks rules — so we compute defensively.
  const dashProjectName = setup.activeProject?.project_name ?? null
  const dashCounts = data?.counts
  const dashFix = data?.fixSummary
  const dashboardHeroStats = useMemo(() => {
    if (!dashCounts || !dashFix) return null
    const integrationIssues = (data?.integrations ?? []).filter(
      (i) => i.lastStatus != null && i.lastStatus !== 'ok',
    ).length
    return {
      openBacklog: dashCounts.openBacklog,
      fixesInProgress: dashFix.inProgress,
      fixesFailed: dashFix.failed,
      openPrs: dashFix.openPrs ?? dashCounts.openPrs,
      integrationIssues,
    }
  }, [dashCounts, dashFix, data?.integrations])
  usePublishPageHeroStats('/dashboard', dashboardHeroStats)
  const dashSummary = loading
    ? 'Loading dashboard…'
    : !data || data.empty
      ? 'Waiting for first report'
      : dashCounts
        ? `${dashCounts.openBacklog} to triage · ${dashFix?.inProgress ?? 0} fix${(dashFix?.inProgress ?? 0) === 1 ? '' : 'es'} in flight${dashFix?.failed ? ` · ${dashFix.failed} failed` : ''}`
        : undefined
  usePublishPageContext({
    route: '/dashboard',
    title: dashProjectName ? `Dashboard · ${dashProjectName}` : 'Dashboard',
    summary: dashSummary,
    // `openBacklog` is the queue of reports the user still needs to
    // action — treat every untriaged report as deserving the favicon
    // red dot so the operator sees the nudge even from another tab.
    criticalCount: dashCounts?.openBacklog ?? 0,
    questions: [
      (dashCounts?.openBacklog ?? 0) > 0
        ? `What\u2019s in my backlog of ${dashCounts!.openBacklog} reports right now?`
        : 'Is the PDCA loop healthy this week?',
      'Where is the bottleneck in the PDCA loop?',
      'What changed in the last 24 hours I should know about?',
    ],
    actions: [
      {
        id: 'reload-dashboard',
        label: 'Refresh dashboard',
        hint: 'Re-fetch the dashboard payload',
        run: () => { void reload() },
      },
    ],
  })

  if (loading) return <DashboardSkeleton />
  if (error) return <ErrorAlert message={error} onRetry={reload} />
  if (!data || data.empty) return <GettingStartedEmpty />

  const counts = data.counts!
  const fixSummary = data.fixSummary!
  const reportsByDay = data.reportsByDay ?? []
  const llmByDay = data.llmByDay ?? []
  const activity = data.activity ?? []
  const lastReportAt = activity.find(a => a.kind === 'report')?.at ?? null
  const projectName = setup.activeProject?.project_name ?? null
  const sdkInstalled = setup.activeProject ? !setup.isStepIncomplete('sdk_installed') : false
  const showFirstReportHero =
    !!setup.activeProject &&
    sdkInstalled &&
    setup.activeProject.report_count === 0
  // First-action clarity: when required setup steps are
  // missing, hide the wall of KPIs/charts/cockpit by default. Show only the
  // checklist + hero intro so the user has exactly one thing to do.
  const setupIncomplete = !!setup.activeProject && !setup.selectors.done && setup.selectors.required_complete < setup.selectors.required_total
  const renderFullDashboard = !setupIncomplete || showFullDashboard
  const hasPdcaStages = !!(data.pdcaStages && data.pdcaStages.length > 0)
  const showPdcaFlow = isAdvanced && renderFullDashboard && hasPdcaStages && !showFirstReportHero
  const showHeroIntro =
    !hideOverviewChrome && !showFirstReportHero && hasPdcaStages && !showPdcaFlow

  const pdcaFlowBlock = showPdcaFlow ? (
    <>
      <div className="hidden sm:block">
        <PdcaFlow
          variant="live"
          stages={data.pdcaStages!}
          focusStage={data.focusStage}
          runningStage={inferRunningStage(data)}
          activity={activity}
          interactive
          showActionPanel
          ariaLabel="Live PDCA loop — live counts per stage with the current bottleneck highlighted. Click a stage to inspect it."
        />
      </div>
      <div className="sm:hidden">
        <PdcaCockpit stages={data.pdcaStages!} focusStage={data.focusStage} />
      </div>
    </>
  ) : null

  return (
    <div className="space-y-3">
      <Confetti triggerKey={confettiKey} />
      <PageHeaderBar
        title={copy?.title ?? 'Dashboard'}
        description={copy?.description ?? (projectName ? `Your loop on ${projectName}` : undefined)}
        helpTitle={copy?.help?.title ?? 'About the Dashboard'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? '14-day operational view of bug intake, LLM cost, auto-fix pipeline, integration health, and the triage queue. Every tile links to the page where you can act on it.'}
        helpUseCases={copy?.help?.useCases ?? [
          'See whether report intake is rising or falling vs the prior week',
          'Catch a backlog of un-triaged reports before users complain',
          'Spot a regression in LLM cost or failure rate after a prompt change',
          'Jump into the highest-priority report that needs review',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Click any KPI or row to drill in. Hover the chart bars for per-day totals.'}
      >
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} channel={channelState} />
        <Btn size="sm" variant="ghost" onClick={reload}>
          Refresh
        </Btn>
        <Link to="/reports" className="text-xs text-brand hover:text-brand-hover">
          View all reports →
        </Link>
      </PageHeaderBar>

      {/* Condensed plain-language insight strip — 1-2 sentence verdict */}
      {renderFullDashboard && dashboardHeroStats && (() => {
        const { tone, sentence } = deriveDashboardInsight({
          openBacklog: dashboardHeroStats.openBacklog,
          fixesInProgress: dashboardHeroStats.fixesInProgress,
          fixesFailed: dashboardHeroStats.fixesFailed,
          integrationIssues: dashboardHeroStats.integrationIssues,
          reports14d: counts.openBacklog ?? 0,
        })
        const toneClasses: Record<string, string> = {
          ok: 'border-ok/25 bg-ok-muted/40 text-ok',
          warn: 'border-warn/30 bg-warn-muted/40 text-warn-fg',
          danger: 'border-danger/30 bg-danger-muted/40 text-danger',
        }
        return (
          <div
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${toneClasses[tone] ?? toneClasses.ok}`}
            role="status"
            aria-live="polite"
          >
            <span className="mt-px shrink-0 text-base leading-none">
              {tone === 'danger' ? '🔴' : tone === 'warn' ? '🟡' : '🟢'}
            </span>
            <span>{sentence}</span>
          </div>
        )
      })()}

      {showHeroIntro && (
        <HeroIntro
          stages={data.pdcaStages!}
          focusStage={data.focusStage}
          projectName={projectName}
          lastReportAt={lastReportAt}
        />
      )}

      {setup.activeProject && (
        <SetupChecklist
          project={setup.activeProject}
          mode="banner"
          onRefresh={setup.reload}
          adminEndpointHost={setup.data?.admin_endpoint_host ?? null}
        />
      )}

      {setup.activeProject && (
        <SdkUpgradeBanner projectId={setup.activeProject.project_id} />
      )}

      {setupIncomplete && !showFullDashboard && (
        <div className="flex items-center justify-between rounded-md border border-edge-subtle bg-surface-raised/30 px-3 py-2.5">
          <p className="text-xs text-fg-muted">
            Finish setup above to unlock the full dashboard. You can peek now if you like.
          </p>
          <Btn size="sm" variant="ghost" onClick={() => setShowFullDashboard(true)}>
            Show full dashboard
          </Btn>
        </div>
      )}

      {pdcaFlowBlock}

      <LivePdcaPipeline
        projectId={setup.activeProject?.project_id}
        pdcaStages={data.pdcaStages}
        onDemoReportSent={() => {
          setup.reload()
          reload()
        }}
      />

      {showFirstReportHero && setup.activeProject && (
        <FirstReportHero
          projectId={setup.activeProject.project_id}
          projectName={setup.activeProject.project_name}
          onReportSent={() => {
            setup.reload()
            reload()
          }}
        />
      )}

      {renderFullDashboard && (
        <>
          <QuotaBanner />

          <KpiRow
            counts={counts}
            fixSummary={fixSummary}
            reportsByDay={reportsByDay}
            llmByDay={llmByDay}
            pdcaStages={data.pdcaStages}
          />

          <ChartsRow
            reportsByDay={reportsByDay}
            llmByDay={llmByDay}
            chartEvents={chartEvents}
          />

          <TriageAndFixRow triageQueue={data.triageQueue ?? []} fixSummary={fixSummary} />

          <InsightsRow
            topComponents={data.topComponents ?? []}
            integrations={data.integrations ?? []}
            activity={activity}
          />

          {activeProjectId && (
            <div className="grid gap-3 md:grid-cols-2">
              <PlatformHealthTile projectId={activeProjectId} />
              <QaCoverageTile projectId={activeProjectId} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
