/**
 * FILE: apps/admin/src/pages/DashboardPage.tsx
 * PURPOSE: 14-day operational view of bug intake, LLM cost, auto-fix
 *          pipeline, integration health, and the triage queue. Page-level
 *          orchestration only — data load + composition. Each row is a
 *          dedicated subcomponent in components/dashboard/* so they can
 *          evolve independently and stay below the 30-line-function limit.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PageHeader, PageHelp, Btn, Loading, ErrorAlert } from '../components/ui'
import { SetupChecklist } from '../components/SetupChecklist'
import { GettingStartedEmpty } from '../components/dashboard/GettingStartedEmpty'
import { QuotaBanner } from '../components/dashboard/QuotaBanner'
import { PdcaCockpit } from '../components/dashboard/PdcaCockpit'
import { KpiRow } from '../components/dashboard/KpiRow'
import { ChartsRow } from '../components/dashboard/ChartsRow'
import { TriageAndFixRow } from '../components/dashboard/TriageAndFixRow'
import { InsightsRow } from '../components/dashboard/InsightsRow'
import { QuickFiltersCard } from '../components/dashboard/QuickFiltersCard'
import type { DashboardData } from '../components/dashboard/types'

export function DashboardPage() {
  const { data, loading, error, reload } = usePageData<DashboardData>('/v1/admin/dashboard')
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)

  if (loading) return <Loading text="Loading dashboard..." />
  if (error) return <ErrorAlert message={error} onRetry={reload} />
  if (!data || data.empty) return <GettingStartedEmpty />

  const counts = data.counts!
  const fixSummary = data.fixSummary!
  const reportsByDay = data.reportsByDay ?? []
  const llmByDay = data.llmByDay ?? []

  return (
    <div>
      <PageHeader title="Dashboard">
        <Btn size="sm" variant="ghost" onClick={reload}>
          Refresh
        </Btn>
        <Link to="/reports" className="text-xs text-brand hover:text-brand-hover">
          View all reports →
        </Link>
      </PageHeader>

      <PageHelp
        title="About the Dashboard"
        whatIsIt="14-day operational view of bug intake, LLM cost, auto-fix pipeline, integration health, and the triage queue. Every tile links to the page where you can act on it."
        useCases={[
          'See whether report intake is rising or falling vs the prior week',
          'Catch a backlog of un-triaged reports before users complain',
          'Spot a regression in LLM cost or failure rate after a prompt change',
          'Jump into the highest-priority report that needs review',
        ]}
        howToUse="Click any KPI or row to drill in. Hover the chart bars for per-day totals."
      />

      {setup.activeProject && (
        <SetupChecklist project={setup.activeProject} mode="banner" onRefresh={setup.reload} />
      )}

      <QuotaBanner />

      {data.pdcaStages && data.pdcaStages.length > 0 && (
        <PdcaCockpit stages={data.pdcaStages} focusStage={data.focusStage} />
      )}

      <KpiRow counts={counts} fixSummary={fixSummary} reportsByDay={reportsByDay} />

      <ChartsRow
        reportsByDay={reportsByDay}
        llmByDay={llmByDay}
        totalLlmCalls={counts.llmCalls14d}
      />

      <TriageAndFixRow triageQueue={data.triageQueue ?? []} fixSummary={fixSummary} />

      <InsightsRow
        topComponents={data.topComponents ?? []}
        integrations={data.integrations ?? []}
        activity={data.activity ?? []}
      />

      <QuickFiltersCard />
    </div>
  )
}
