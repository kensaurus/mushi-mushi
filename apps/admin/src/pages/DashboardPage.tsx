/**
 * FILE: apps/admin/src/pages/DashboardPage.tsx
 * PURPOSE: 14-day operational view of bug intake, LLM cost, auto-fix
 *          pipeline, integration health, and the triage queue. Page-level
 *          orchestration only — data load + composition. Each row is a
 *          dedicated subcomponent in components/dashboard/* so they can
 *          evolve independently and stay below the 30-line-function limit.
 */

import { useCallback, useState } from 'react'
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
import { LivePdcaPipeline } from '../components/dashboard/LivePdcaPipeline'
import { KpiRow } from '../components/dashboard/KpiRow'
import { ChartsRow } from '../components/dashboard/ChartsRow'
import { TriageAndFixRow } from '../components/dashboard/TriageAndFixRow'
import { InsightsRow } from '../components/dashboard/InsightsRow'
import type { DashboardData } from '../components/dashboard/types'
import { usePageCopy } from '../lib/copy'

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
  // First-action clarity (Wave K Phase 1): when required setup steps are
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
            <PdcaCockpit stages={data.pdcaStages} focusStage={data.focusStage} />
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
