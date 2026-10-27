/**
 * FILE: apps/admin/src/pages/DashboardPage.tsx
 * PURPOSE: Home → Today: what the app's owner wants to know on opening it.
 *          Is the app up, erroring, slow? What needs me? What is shipping
 *          and what is waiting? Which pages hurt? Who can reach it?
 *
 *          One call (GET /v1/admin/projects/:id/home) feeds every section;
 *          a section whose read failed says so on its own, and one that is
 *          not connected says how to connect it. Page-level orchestration
 *          only; each section is a component in components/home/*.
 */

import { useCallback, useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { useMilestoneCelebration } from '../lib/useMilestoneCelebration'
import { useEntitlements } from '../lib/useEntitlements'
import { Confetti } from '../components/Confetti'
import { EmptySectionMessage, FreshnessPill, RefreshIconButton } from '../components/ui'
import { PageLoadError } from '../components/PageLoadError'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { SetupChecklist } from '../components/SetupChecklist'
import { sdkHealthHref } from '../lib/sdkHealth'
import { FirstReportHero } from '../components/dashboard/FirstReportHero'
import { QuotaBanner } from '../components/dashboard/QuotaBanner'
import { HeroIntro } from '../components/dashboard/HeroIntro'
import { AppCard, AppCardSkeleton } from '../components/home/AppCard'
import { HealthStrip, HealthStripSkeleton } from '../components/home/HealthStrip'
import { NeedsYouCard, NeedsYouSkeleton } from '../components/home/NeedsYouCard'
import { ReleaseCard, ReleaseSkeleton } from '../components/home/ReleaseCard'
import { SitemapCard, SitemapSkeleton } from '../components/home/SitemapCard'
import { WeekCard, WeekSkeleton } from '../components/home/WeekCard'
import { ActivityCard, ActivitySkeleton } from '../components/home/ActivityCard'
import { AccessCard, AccessSkeleton } from '../components/home/AccessCard'
import { HowThisWorks } from '../components/home/HowThisWorks'
import type { ProjectHome } from '../lib/projectHome'
import { usePageCopy } from '../lib/copy'
import { IconDashboard } from '../components/icons'

export function DashboardPage() {
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const { data, loading, error, isValidating, lastFetchedAt, reload } = usePageData<ProjectHome>(
    activeProjectId ? `/v1/admin/projects/${activeProjectId}/home` : null,
  )
  const ent = useEntitlements()
  const toast = useToast()
  const navigate = useNavigate()
  const copy = usePageCopy('/dashboard')

  // A report, fix or deploy changes Home at once; 1 s debounce for bursts.
  const { channelState } = useRealtimeReload(
    ['reports', 'fix_attempts', 'fix_events', 'fix_dispatch_jobs'],
    reload,
    { debounceMs: 1000, enabled: !loading && !error && !!data },
  )

  // The first merged fix is the proof the loop closed on this app.
  const onFirstMergedFix = useCallback(() => {
    toast.success('Your first auto-fix was merged 🎉', 'Mushi fixed a bug end to end. Want to see the merged PR?', {
      label: 'View merged fixes',
      onClick: () => navigate('/fixes'),
    })
  }, [toast, navigate])
  const { triggerKey: confettiKey } = useMilestoneCelebration('first-merged-fix', setup.activeProject?.merged_fix_count ?? null, {
    onFire: onFirstMergedFix,
  })

  const projectName = setup.activeProject?.project_name ?? data?.app.data?.name ?? null
  const needs = data?.needsYou.data ?? []
  const summary = useMemo(() => {
    if (!data) return loading ? 'Loading Home…' : undefined
    const bad = (data.health.data ?? []).filter((h) => h.light === 'bad').map((h) => h.label)
    return [needs.length ? `${needs.length} need${needs.length === 1 ? 's' : ''} you` : 'Nothing needs you', bad.length ? `problem: ${bad.join(', ')}` : null].filter(Boolean).join(' · ')
  }, [data, loading, needs.length])
  usePublishPageContext({
    route: '/dashboard',
    title: projectName ? `Home · ${projectName}` : 'Home',
    summary,
    criticalCount: needs.length,
    questions: [
      needs[0] ? `Help me with: ${needs[0].text}` : 'Is my app healthy this week?',
      'What changed in the last 24 hours I should know about?',
      'Which page of my app has the most bugs?',
    ],
    actions: [{ id: 'reload-home', label: 'Refresh Home', hint: 'Re-read every Home section', run: () => void reload() }],
  })

  // A resolved "no projects" answer goes to the wizard; a failed setup read keeps the page.
  if (setup.resolved && !setup.hasAnyProject) return <Navigate to="/onboarding" replace />
  if (!setup.resolved && setup.error && !setup.loading) {
    return <PageLoadError error={setup.error} onRetry={setup.reload} resource="your setup status" endpoint="/v1/admin/setup" />
  }

  const project = setup.activeProject
  const sdkInstalled = project ? !setup.isStepIncomplete('sdk_installed') : false
  const showFirstReportHero = !!project && sdkInstalled && project.report_count === 0
  const setupIncomplete = !!project && !setup.selectors.done && setup.selectors.required_complete < setup.selectors.required_total
  // While a required step is open the hero names it with its fix, never "healthy".
  const openStep = setupIncomplete ? (project?.steps.find((s) => s.required && !s.complete) ?? null) : null
  const heroSetupStep =
    openStep && project
      ? {
          label: openStep.label,
          description: openStep.description,
          ctaLabel: openStep.id === 'sdk_installed' ? 'Fix it' : openStep.cta_label,
          ctaTo: openStep.id === 'sdk_installed' ? sdkHealthHref(project.project_id) : openStep.cta_to,
          done: setup.selectors.required_complete,
          total: setup.selectors.required_total,
        }
      : null

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-dashboard">
      <Confetti triggerKey={confettiKey} />
      <PageHeaderBar
        title={copy?.title ?? 'Home'}
        icon={<IconDashboard />}
        description={copy?.description ?? (projectName ? `How ${projectName} is doing right now` : undefined)}
        helpTitle={copy?.help?.title ?? 'About Home'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'One page per app: is it up and healthy, what needs you, what is shipping, which pages have bugs, and who can reach it.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Check the site is up and CI on main is green before you start the day',
            'Clear the few things that need you, most costly first',
            'See how many bugs wait for a fix and how far the next release has got',
            'Compare this week with last week',
          ]
        }
        helpHowToUse={copy?.help?.howToUse ?? 'Every number opens the list it counts. Grey lights are not connected yet; their button says how to connect them.'}
      >
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} channel={channelState} />
        <RefreshIconButton onClick={() => void reload()} loading={isValidating} label="Refresh Home" />
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            id: 'setup-hero',
            priority: POSTURE_PRIORITY.status,
            show: !!heroSetupStep,
            children: heroSetupStep ? <HeroIntro stages={[]} focusStage={null} projectName={projectName} setupStep={heroSetupStep} /> : null,
          },
          { id: 'quota', priority: POSTURE_PRIORITY.nudge, children: <QuotaBanner /> },
          {
            id: 'first-report',
            priority: POSTURE_PRIORITY.recommended,
            show: showFirstReportHero,
            children: project ? (
              <FirstReportHero
                projectId={project.project_id}
                projectName={project.project_name}
                onReportSent={() => {
                  setup.reload()
                  void reload()
                }}
              />
            ) : null,
          },
        ]}
      />

      {/* The setup steps, with Fix it on the SDK step. */}
      {heroSetupStep && project && (
        <SetupChecklist project={project} mode="banner" onRefresh={setup.reload} adminEndpointHost={setup.data?.admin_endpoint_host} />
      )}

      {error && !data ? (
        <PageLoadError error={error} onRetry={reload} resource="Home" endpoint="/v1/admin/projects/:id/home" />
      ) : !activeProjectId && setup.resolved && !setup.loading ? (
        <EmptySectionMessage text="Pick an app in the switcher at the top to see how it is doing." />
      ) : !data || !activeProjectId ? (
        <HomeSkeleton />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-12 [&>*]:min-w-0">
            <div className="lg:col-span-5">
              <AppCard section={data.app} projectId={activeProjectId} canEdit={ent.canEditProject} onRefreshed={() => void reload()} />
            </div>
            <div className="lg:col-span-7">
              <HealthStrip section={data.health} />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
            <NeedsYouCard section={data.needsYou} partial={data.partial} />
            <ReleaseCard section={data.release} projectId={activeProjectId} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
            <SitemapCard section={data.sitemap} />
            <AccessCard section={data.access} auditLog={ent.has('audit_log')} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
            <WeekCard section={data.week} />
            <ActivityCard section={data.activity} />
          </div>

          <HowThisWorks defaultOpen={!!project && project.report_count === 0} />
        </>
      )}
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading Home">
      <div className="grid gap-3 lg:grid-cols-12 [&>*]:min-w-0">
        <div className="lg:col-span-5">
          <AppCardSkeleton />
        </div>
        <div className="lg:col-span-7">
          <HealthStripSkeleton />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <NeedsYouSkeleton />
        <ReleaseSkeleton />
      </div>
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <SitemapSkeleton />
        <AccessSkeleton />
      </div>
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <WeekSkeleton />
        <ActivitySkeleton />
      </div>
    </div>
  )
}
