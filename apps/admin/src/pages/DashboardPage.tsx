/**
 * FILE: apps/admin/src/pages/DashboardPage.tsx
 * PURPOSE: 14-day operational view of bug intake, LLM cost, auto-fix
 *          pipeline, integration health, and the triage queue. Page-level
 *          orchestration only — data load + composition. Each row is a
 *          dedicated subcomponent in components/dashboard/* so they can
 *          evolve independently and stay below the 30-line-function limit.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { useMilestoneCelebration } from '../lib/useMilestoneCelebration'
import { Confetti } from '../components/Confetti'
import { PageHeader, PageHelp, Btn, ErrorAlert } from '../components/ui'
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
import type { DashboardData } from '../components/dashboard/types'
import type { PdcaStageId } from '../lib/pdca'
import { usePageCopy } from '../lib/copy'

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
  const { data, loading, error, reload } = usePageData<DashboardData>('/v1/admin/dashboard')
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const toast = useToast()
  const navigate = useNavigate()
  const [showFullDashboard, setShowFullDashboard] = useState(false)
  const copy = usePageCopy('/')

  // First-fix-merged celebration: when `merged_fix_count` flips 0 → 1 we
  // fire a confetti burst + a toast with a CTA to the merged PR. This is the
  // single most important peak-end moment in the whole loop — it's the proof
  // that Mushi closed a PDCA cycle on the user's project. (Round 2 polish.)
  // SPA-route via `navigate` rather than `window.location.assign` — the
  // latter discards in-memory state (toast queue, scroll, focus) on what
  // should be a celebratory in-app jump.
  // Lightweight live-pulse poll for the LivePdcaPipeline. We refresh the
  // dashboard payload every 15s while the tab is visible so stage counts
  // stay current and the pipeline can pulse the right node when a real
  // report / fix / judge / merge lands. Pauses on tab hide to avoid
  // burning Supabase function-invocations in the background.
  useEffect(() => {
    if (loading || error || !data || data.empty) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer) return
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') reload()
      }, 15_000)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop())
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [data, error, loading, reload])

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

  return (
    <div>
      <Confetti triggerKey={confettiKey} />
      <PageHeader
        title={copy?.title ?? 'Dashboard'}
        description={copy?.description ?? (projectName ? `Your loop on ${projectName}` : undefined)}
      >
        <Btn size="sm" variant="ghost" onClick={reload}>
          Refresh
        </Btn>
        <Link to="/reports" className="text-xs text-brand hover:text-brand-hover">
          View all reports →
        </Link>
      </PageHeader>

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

      {!showFirstReportHero && data.pdcaStages && data.pdcaStages.length > 0 && (
        <HeroIntro
          stages={data.pdcaStages}
          focusStage={data.focusStage}
          projectName={projectName}
          lastReportAt={lastReportAt}
        />
      )}

      {setup.activeProject && (
        <SetupChecklist project={setup.activeProject} mode="banner" onRefresh={setup.reload} />
      )}

      {setupIncomplete && !showFullDashboard && (
        <div className="mt-4 flex items-center justify-between rounded-md border border-edge-subtle bg-surface-raised/30 px-3 py-2.5">
          <p className="text-xs text-fg-muted">
            Finish setup above to unlock the full dashboard. You can peek now if you like.
          </p>
          <Btn size="sm" variant="ghost" onClick={() => setShowFullDashboard(true)}>
            Show full dashboard
          </Btn>
        </div>
      )}

      {renderFullDashboard && (
        <>
          <PageHelp
            title={copy?.help?.title ?? 'About the Dashboard'}
            whatIsIt={copy?.help?.whatIsIt ?? '14-day operational view of bug intake, LLM cost, auto-fix pipeline, integration health, and the triage queue. Every tile links to the page where you can act on it.'}
            useCases={copy?.help?.useCases ?? [
              'See whether report intake is rising or falling vs the prior week',
              'Catch a backlog of un-triaged reports before users complain',
              'Spot a regression in LLM cost or failure rate after a prompt change',
              'Jump into the highest-priority report that needs review',
            ]}
            howToUse={copy?.help?.howToUse ?? 'Click any KPI or row to drill in. Hover the chart bars for per-day totals.'}
          />

          <QuotaBanner />

          {data.pdcaStages && data.pdcaStages.length > 0 && (
            <>
              {/* Live React Flow canvas at sm+ breakpoints — pairs the four
                  stages with live counts, bottlenecks, and an animated
                  gradient edge out of the current focus stage so the eye
                  lands on the bottleneck without reading text. */}
              <div className="hidden sm:block mb-4">
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">
                    Loop status &mdash; Plan, Do, Check, Act
                  </h2>
                  <span className="text-2xs text-fg-faint">
                    Plan → Do → Check → Act (loops back)
                  </span>
                </div>
                <PdcaFlow
                  variant="live"
                  stages={data.pdcaStages}
                  focusStage={data.focusStage}
                  runningStage={inferRunningStage(data)}
                  activity={activity}
                  interactive
                  showActionPanel
                  showActivityLog
                  ariaLabel="Live PDCA loop — live counts per stage with the current bottleneck highlighted. Click a stage to inspect it."
                />
              </div>
              {/* Stacked-cards fallback on narrow viewports where a React
                  Flow canvas doesn't read well; the cockpit already has a
                  mobile-optimised vertical layout so we keep it verbatim. */}
              <div className="sm:hidden">
                <PdcaCockpit stages={data.pdcaStages} focusStage={data.focusStage} />
              </div>
            </>
          )}

          <KpiRow counts={counts} fixSummary={fixSummary} reportsByDay={reportsByDay} llmByDay={llmByDay} />

          <ChartsRow
            reportsByDay={reportsByDay}
            llmByDay={llmByDay}
            totalLlmCalls={counts.llmCalls14d}
          />

          <TriageAndFixRow triageQueue={data.triageQueue ?? []} fixSummary={fixSummary} />

          <InsightsRow
            topComponents={data.topComponents ?? []}
            integrations={data.integrations ?? []}
            activity={activity}
          />
        </>
      )}
    </div>
  )
}
