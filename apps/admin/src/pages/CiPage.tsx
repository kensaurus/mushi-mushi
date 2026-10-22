/**
 * CiPage — /ci, "CI runners" (Plan 022 Phase 4, ADR 0033).
 *
 * Why a fix is slow to land: where its tests run, how long they wait for a
 * machine, and what slows them down. Bucket B under ADR 0016, never the hero.
 *
 * Top to bottom: the queue (Waiting → Running → Finished), a per-runner
 * timeline, stat tiles, the runner map (machines → runners → repos → live
 * jobs), "Speed it up" advice, slowest jobs and steps, and recent test
 * machine failures, then "Cost and speed" (Plan 022 Phase 7, ADR 0037:
 * GitHub-hosted vs your own machines, read-only, never the top of the page).
 * Scope follows the header switcher (lib/projectScope.ts): one app, or
 * "All apps" for every project the caller can see. The toggle here mirrors
 * that choice. Polls every 30 s while the tab is visible with
 * `refresh=1` (the server live-syncs GitHub at most once a minute).
 *
 * Data: GET /v1/admin/ci/overview?project_id=&days=7&refresh=1 → CiOverview
 *       GET /v1/admin/ci/compare?project_id=&days=30 → CiCompare (Cost and speed)
 *       GET /v1/admin/ci/placement?project_id= → CiPlacement (Where CI runs, ADR 0037)
 *       GET /v1/admin/fixes?limit=100 (project scope) → "Mushi fix" links
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { Btn, Callout, EmptyState, Loading, Section, SegmentedControl } from '../components/ui'
import { IconBolt, IconClock, IconCost, IconGauge, IconNetwork, IconQueue, IconServerOff, IconSliders } from '../components/icons'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useProjectScope, useSetProjectScopeMode } from '../lib/projectScope'
import { CiQueueBoard } from '../components/ci/CiQueueBoard'
import { CiTimeline } from '../components/ci/CiTimeline'
import { CiNodeDrawer } from '../components/ci/CiNodeDrawer'
import { CiAdviceList, CiInfraFailures, CiSlowJobs } from '../components/ci/CiSections'
import { CiSummary } from '../components/ci/CiSummary'
import { CiCostSection } from '../components/ci/CiCostSection'
import { CiPlacementSection } from '../components/ci/CiPlacementSection'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { docsUrl } from '../lib/docsUrl'
import { useNow } from '../lib/useNow'
import type { CiOverview } from '../lib/ciTypes'
import type { FixAttempt } from '../components/fixes/types'
import { buildFixLinks, formatSeconds, isCiOverviewEmpty, permissionsNotice } from '../lib/ciView'

const CiRunnerMap = lazy(() => import('../components/ci/CiRunnerMap').then((m) => ({ default: m.CiRunnerMap })))

const POLL_MS = 30_000

type Scope = 'project' | 'all'
const SCOPE_OPTIONS = [
  { id: 'project', label: 'This app' },
  { id: 'all', label: 'All apps' },
] as const

/** "Updated 12 s ago", ticking. */
function UpdatedAgo({ at, validating }: { at: string | null; validating: boolean }) {
  const now = useNow(5_000)
  if (validating) return <span className="text-2xs text-fg-muted">Updating…</span>
  if (!at) return null
  const secs = Math.max(0, Math.round((now - Date.parse(at)) / 1000))
  return (
    <span className="text-2xs text-fg-muted tabular-nums" data-testid="ci-updated-ago">
      Updated {formatSeconds(secs)} ago
    </span>
  )
}

/** Reload every `ms` while the tab is visible, and once on coming back. */
function useVisiblePolling(reload: () => void, ms: number): void {
  useEffect(() => {
    let id: number | null = null
    const start = () => {
      if (id == null) id = window.setInterval(reload, ms)
    }
    const stop = () => {
      if (id != null) window.clearInterval(id)
      id = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        reload()
        start()
      } else stop()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reload, ms])
}

export function CiPage() {
  const projectId = useActiveProjectId()
  const [searchParams] = useSearchParams()
  const focusJobId = searchParams.get('job')
  const scopeChoice: Scope = useProjectScope().mode
  const setScopeChoice = useSetProjectScopeMode()
  const scope: Scope = projectId ? scopeChoice : 'all'

  const path =
    scope === 'project' && projectId
      ? `/v1/admin/ci/overview?project_id=${encodeURIComponent(projectId)}&days=7&refresh=1`
      : '/v1/admin/ci/overview?days=7&refresh=1'
  const page = usePageData<CiOverview>(path, { scope: scope === 'all' ? 'enumeration' : 'project' })
  const { data, reload } = page
  useVisiblePolling(reload, POLL_MS)

  // "Mushi fix" links for jobs on a fix's PR (this app only).
  const fixes = usePageData<{ fixes: FixAttempt[] }>(scope === 'project' && projectId ? '/v1/admin/fixes?limit=100' : null)
  const fixLinks = useMemo(() => buildFixLinks(fixes.data?.fixes ?? []), [fixes.data])

  const [selected, setSelected] = useState<string | null>(null)
  const onSelect = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), [])

  const stats = data?.stats
  usePublishPageContext({
    route: '/ci',
    title: 'CI runners',
    summary: stats
      ? `${stats.jobs} jobs in ${data.window.days} days · wait p95 ${formatSeconds(stats.queueP95s)} · ${stats.infraFailures} test machine failures`
      : page.error
        ? "CI runners couldn't load"
        : 'Loading CI runners',
    questions: ['Why are my fixes slow to land?', 'Which runner keeps failing?', 'How do I make CI faster?', 'What does my CI cost, and would my own machine be cheaper?'],
  })

  const notice = data ? permissionsNotice(data.permissions) : null
  const empty = data ? isCiOverviewEmpty(data) : false

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-ci">
      <PageHeaderBar
        title="CI runners"
        icon={<IconGauge />}
        description="Where your tests run, how long they wait, and what slows them down."
        helpTitle="About CI runners"
        helpWhatIsIt="Every fix Mushi opens is tested by your CI before it can merge. This page shows the machines that run those tests, the jobs waiting for one, and why your fixes take as long as they do to land."
        helpHowToUse="Start with the queue: a long Waiting column means too few machines. A job marked “Test machine stopped” was not a code failure; re-run it. Speed it up lists changes with the evidence behind each one."
      >
        <UpdatedAgo at={data?.refreshedAt ?? data?.generatedAt ?? null} validating={page.isValidating && !page.loading} />
        <Btn size="sm" variant="ghost" onClick={reload} disabled={page.isValidating} title="Read the latest jobs from GitHub now">
          Refresh
        </Btn>
        {projectId && (
          <SegmentedControl<Scope> value={scope} options={SCOPE_OPTIONS} onChange={setScopeChoice} ariaLabel="Which apps" size="sm" />
        )}
      </PageHeaderBar>

      {page.error && <PageLoadError error={page.error} resource="CI runners" endpoint={path} onRetry={reload} />}
      {page.loading && !data && <Loading text="Reading your CI…" />}

      <PagePosture
        slots={[
          {
            id: 'ci-permissions',
            priority: POSTURE_PRIORITY.status,
            show: notice != null,
            children: (
              <Callout tone="warn" label="GitHub access">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{notice}</span>
                  <a href={docsUrl('/operating/ci-runners#github-permissions')} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                    How to give Mushi access ↗
                  </a>
                </span>
              </Callout>
            ),
          },
        ]}
      />

      {data && empty && (
        <EmptyState
          title="No CI jobs seen yet"
          description="Mushi shows runners once GitHub reports a job for this app's repositories, or once a machine that runs your tests reports in: run these two commands on it."
          hints={['mushi runner key', 'mushi runner hooks install --dir <runner dir>']}
          action={
            <Btn size="sm" variant="ghost" href={docsUrl('/operating/ci-runners')}>
              How to set up CI runners
            </Btn>
          }
        />
      )}

      {data && !empty && (
        <>
          <CiSummary overview={data} />

          <Section title="Queue" id="ci-queue" icon={<IconQueue />}>
            <p className="mb-2 text-xs text-fg-muted">Every job for your fixes, from waiting for a machine to finished. Re-run a job the test machine stopped; open the fix for one that failed.</p>
            <CiQueueBoard jobs={data.jobs} fixLinks={fixLinks} focusJobId={focusJobId} />
          </Section>

          <Section title="Timeline" id="ci-timeline" icon={<IconClock />}>
            <p className="mb-2 text-xs text-fg-muted">One row per test machine. Gaps are idle time; striped bars are jobs waiting for a machine.</p>
            <CiTimeline jobs={data.jobs} />
          </Section>

          <Section title="Runner map" id="ci-map" icon={<IconNetwork />}>
            <p className="mb-2 text-xs text-fg-muted">Your machines, the runners on them, the repositories they serve, and the jobs waiting or running now. Click any card for its health and recent jobs.</p>
            <PanelErrorBoundary label="Runner map">
              <Suspense fallback={<Loading text="Loading the map…" />}>
                <CiRunnerMap overview={data} selectedId={selected} onSelect={onSelect} />
              </Suspense>
            </PanelErrorBoundary>
          </Section>

          <Section title="Speed it up" id="ci-advice" icon={<IconBolt />}>
            <p className="mb-2 text-xs text-fg-muted">Changes that would land your fixes sooner, each with the evidence and a copy-ready fix.</p>
            <CiAdviceList advice={data.advice} />
          </Section>

          <Section title="Cost and speed" id="ci-cost" icon={<IconCost />}>
            <PanelErrorBoundary label="Cost and speed">
              <CiCostSection projectId={projectId} scope={scope} />
            </PanelErrorBoundary>
          </Section>

          <Section title="Where CI runs" id="ci-placement" icon={<IconSliders />}>
            <p className="mb-2 text-xs text-fg-muted">Move a repo's jobs between GitHub-hosted runners and your own machines through the one runner variable its workflows read. Every change is previewed, approved and watched.</p>
            <PanelErrorBoundary label="Where CI runs">
              <CiPlacementSection projectId={projectId} scope={scope} />
            </PanelErrorBoundary>
          </Section>

          <Section title="Slow jobs" id="ci-slow" icon={<IconGauge />}>
            <CiSlowJobs jobs={data.jobs} slowSteps={data.stats.slowSteps} />
          </Section>

          <Section title="Stopped by the test machine" id="ci-infra" icon={<IconServerOff />}>
            <p className="mb-2 text-xs text-fg-muted">These jobs never finished testing. They are not code failures: re-run them.</p>
            <CiInfraFailures jobs={data.jobs} />
          </Section>

          <CiNodeDrawer overview={data} nodeId={selected} onClose={() => setSelected(null)} onSelect={setSelected} />
        </>
      )}
    </div>
  )
}
