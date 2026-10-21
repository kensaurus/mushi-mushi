/**
 * CiPage — /ci, "CI runners" (Plan 022 Phase 4, ADR 0033).
 *
 * Why a fix is slow to land: where its tests run, how long they wait for a
 * machine, and what slows them down. Bucket B under ADR 0016, never the hero.
 *
 * Top to bottom: the queue (Waiting → Running → Finished), a per-runner
 * timeline, stat tiles, the runner map (machines → runners → repos → live
 * jobs), "Speed it up" advice, slowest jobs and steps, and recent test
 * machine failures. Scope follows the active project; "All apps" reads every
 * project the caller can see. Polls every 30 s while the tab is visible with
 * `refresh=1` (the server live-syncs GitHub at most once a minute).
 *
 * Data: GET /v1/admin/ci/overview?project_id=&days=7&refresh=1 → CiOverview
 *       GET /v1/admin/fixes?limit=100 (project scope) → "Mushi fix" links
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { Btn, Callout, EmptyState, Loading, Section, SegmentedControl } from '../components/ui'
import { IconGauge } from '../components/icons'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { CiQueueBoard } from '../components/ci/CiQueueBoard'
import { CiTimeline } from '../components/ci/CiTimeline'
import { CiNodeDrawer } from '../components/ci/CiNodeDrawer'
import { CiAdviceList, CiInfraFailures, CiSlowJobs, CiStatTiles } from '../components/ci/CiSections'
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
  const [scopeChoice, setScopeChoice] = useState<Scope>('project')
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
    questions: ['Why are my fixes slow to land?', 'Which runner keeps failing?', 'How do I make CI faster?'],
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
                <span>{notice}</span>
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
          <Section title="Queue" id="ci-queue">
            <CiQueueBoard jobs={data.jobs} fixLinks={fixLinks} focusJobId={focusJobId} />
          </Section>

          <Section title="Timeline" id="ci-timeline">
            <CiTimeline jobs={data.jobs} />
          </Section>

          <CiStatTiles stats={data.stats} days={data.window.days} />

          <Section title="Runner map" id="ci-map">
            <p className="mb-2 text-xs text-fg-muted">Machines, then runners, then repositories, then the jobs waiting or running now. Click a card for details.</p>
            <PanelErrorBoundary label="Runner map">
              <Suspense fallback={<Loading text="Loading the map…" />}>
                <CiRunnerMap overview={data} selectedId={selected} onSelect={onSelect} />
              </Suspense>
            </PanelErrorBoundary>
          </Section>

          <Section title="Speed it up" id="ci-advice">
            <CiAdviceList advice={data.advice} />
          </Section>

          <Section title="Slow jobs" id="ci-slow">
            <CiSlowJobs jobs={data.jobs} slowSteps={data.stats.slowSteps} />
          </Section>

          <Section title="Test machine failures" id="ci-infra">
            <CiInfraFailures jobs={data.jobs} />
          </Section>

          <CiNodeDrawer overview={data} nodeId={selected} onClose={() => setSelected(null)} />
        </>
      )}
    </div>
  )
}
