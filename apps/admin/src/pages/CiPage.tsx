/**
 * CiPage — /ci, "CI runners" (Plan 022 Phase 4, ADR 0033).
 *
 * Why a fix is slow to land: where its tests run, how long they wait for a
 * machine, and what slows them down. Bucket B under ADR 0016, never the hero.
 *
 * Four views (`?view=`, 2026-11-06; one long column was 50,000 px tall with
 * All apps, and its settings sat 49,000 px down):
 *   - Now (default): the summary, the queue (Waiting → Running → Finished)
 *     and the per-runner timeline. "Is CI healthy, and why does a job wait?"
 *   - Machines: the runner map (machines → runners → repos → live jobs) and
 *     the jobs the test machine stopped (re-run them).
 *   - Speed and cost: "Speed it up" advice, the slowest jobs and steps, and
 *     "Cost and speed" (Plan 022 Phase 7, ADR 0037: GitHub-hosted vs your own
 *     machines, read-only).
 *   - Settings: where CI runs (ADR 0037 placement).
 * Old `/ci#ci-…` links still work: the hash picks the view, then
 * useScrollToHash scrolls to the section.
 * Scope follows the header switcher (lib/projectScope.ts): one app, or
 * "All apps" for every project the caller can see. The toggle here mirrors
 * that choice. The page paints from the stored jobs first, then asks the
 * server to live-sync GitHub (`refresh=1`, at most once a minute
 * server-side) in the background and re-reads when that returns: on load,
 * every 30 s while the tab is visible, and on Refresh. A live sync took
 * 12.5 s for All apps on 2026-10-22, so it never blocks the first paint.
 *
 * Data: GET /v1/admin/ci/overview?project_id=&days=7 (stored) → CiOverview
 *       GET …&refresh=1 (background live sync, then re-read)
 *       GET /v1/admin/ci/compare?project_id=&days=30 → CiCompare (Cost and speed)
 *       GET /v1/admin/ci/placement?project_id= → CiPlacement (Where CI runs, ADR 0037)
 *       GET /v1/admin/fixes?limit=100 (project scope) → "Mushi fix" links
 *       GET/POST /v1/admin/ci/cost-fix-rollout → "Apply to every app" (CiCostFixRollout)
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { useVisiblePolling } from '../lib/useVisiblePolling'
import { TabbedSubNav } from '../components/TabbedSubNav'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { Btn, Callout, EmptyState, Loading, Section, SegmentedControl } from '../components/ui'
import { IconAlertTriangle, IconBolt, IconClock, IconCost, IconGauge, IconNetwork, IconQueue, IconServerOff, IconSliders } from '../components/icons'
import { CiAttention } from '../components/ci/CiAttention'
import { CiJobTimes } from '../components/ci/CiJobTimes'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { ACTIVE_PROJECT_QUERY_PARAM, setActiveProjectIdSnapshot } from '../lib/activeProject'
import { PROJECT_SCOPE_QUERY_PARAM, setStoredProjectScopeMode, useProjectScope, useSetProjectScopeMode } from '../lib/projectScope'
import { CiQueueBoard } from '../components/ci/CiQueueBoard'
import { CiTimeline } from '../components/ci/CiTimeline'
import { CiNodeDrawer } from '../components/ci/CiNodeDrawer'
import { CiAdviceList, CiInfraFailures, CiSlowJobs } from '../components/ci/CiSections'
import { CiSummary } from '../components/ci/CiSummary'
import { CiCostSection } from '../components/ci/CiCostSection'
import { CiCostFixRollout } from '../components/ci/CiCostFixRollout'
import { CiPlacementSection } from '../components/ci/CiPlacementSection'
import { usePageData } from '../lib/usePageData'
import { apiFetch } from '../lib/supabase'
import { usePublishPageContext } from '../lib/pageContext'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { docsUrl } from '../lib/docsUrl'
import { useNow } from '../lib/useNow'
import type { CiOverview } from '../lib/ciTypes'
import { groupCiAdvice } from '../lib/ciAdvice'
import type { FixAttempt } from '../components/fixes/types'
import { buildCiQueue, buildFixLinks, formatSeconds, isCiOverviewEmpty, permissionsNotice } from '../lib/ciView'
import { useScrollToHash } from '../lib/useScrollToHash'

const CiRunnerMap = lazy(() => import('../components/ci/CiRunnerMap').then((m) => ({ default: m.CiRunnerMap })))

const POLL_MS = 30_000

type Scope = 'project' | 'all'
const SCOPE_OPTIONS = [
  { id: 'project', label: 'This app' },
  { id: 'all', label: 'All apps' },
] as const

export type CiView = 'now' | 'machines' | 'cost' | 'settings'
const CI_VIEWS: ReadonlyArray<{ id: CiView; label: string }> = [
  { id: 'now', label: 'Now' },
  { id: 'machines', label: 'Machines' },
  { id: 'cost', label: 'Speed and cost' },
  { id: 'settings', label: 'Settings' },
]
/** Which view holds each section, so `/ci#ci-placement` and friends still land. */
const SECTION_VIEW: Record<string, CiView> = {
  'ci-summary': 'now',
  'ci-queue': 'now',
  'ci-attention': 'now',
  'ci-job-times': 'now',
  'ci-timeline': 'now',
  'ci-map': 'machines',
  'ci-infra': 'machines',
  'ci-advice': 'cost',
  'ci-slow': 'cost',
  'ci-cost': 'cost',
  'ci-bill-title': 'cost',
  'ci-placement': 'settings',
}

/** `?view=` wins; without it a section hash picks its view; otherwise Now. */
export function resolveCiView(viewParam: string | null, hash: string): CiView {
  if (CI_VIEWS.some((v) => v.id === viewParam)) return viewParam as CiView
  return SECTION_VIEW[hash.replace(/^#/, '')] ?? 'now'
}

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

/**
 * Live-sync GitHub in the background, then re-read the stored overview. One
 * sync at a time; a failed sync still re-reads (the stored jobs are fine).
 */
function useBackgroundLiveSync(livePath: string, scope: 'project' | 'enumeration', reload: () => void) {
  const [syncing, setSyncing] = useState(false)
  const busy = useRef(false)
  // Held in a ref so a new reload identity never re-runs the sync effect.
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const sync = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setSyncing(true)
    try {
      await apiFetch<CiOverview>(livePath, { scope, cache: 'no-store' })
    } catch {
      // The stored jobs still render; the next poll tries again.
    } finally {
      busy.current = false
      setSyncing(false)
      reloadRef.current()
    }
  }, [livePath, scope])
  useEffect(() => {
    void sync()
  }, [sync])
  return { syncing, sync }
}

export function CiPage() {
  const projectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const focusJobId = searchParams.get('job')
  const view = resolveCiView(searchParams.get('view'), location.hash)
  const viewHref = useCallback(
    (id: CiView) => {
      const next = new URLSearchParams(searchParams)
      next.set('view', id)
      return `${location.pathname}?${next.toString()}`
    },
    [searchParams, location.pathname],
  )
  const openView = useCallback(
    (id: CiView) =>
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('view', id)
        return next
      }),
    [setSearchParams],
  )
  const scopeChoice: Scope = useProjectScope().mode
  const setScopeChoice = useSetProjectScopeMode()
  const scope: Scope = projectId ? scopeChoice : 'all'
  // Settings is per app: from All apps, pick one and the page switches to it.
  // ONE navigation that sets the app and drops ?apps=all. Two setSearchParams calls in one click
  // (this one, then setScopeChoice's) each start from the same old URL, so the second wrote the
  // previous ?project= back: picking glot.it opened yen-yen (2026-11-07).
  const pickApp = useCallback(
    (id: string) => {
      setActiveProjectIdSnapshot(id)
      setStoredProjectScopeMode('project')
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set(ACTIVE_PROJECT_QUERY_PARAM, id)
        next.delete(PROJECT_SCOPE_QUERY_PARAM)
        return next
      })
    },
    [setSearchParams],
  )

  const path =
    scope === 'project' && projectId
      ? `/v1/admin/ci/overview?project_id=${encodeURIComponent(projectId)}&days=7`
      : '/v1/admin/ci/overview?days=7'
  const livePath =
    scope === 'project' && projectId
      ? `/v1/admin/ci/overview?project_id=${encodeURIComponent(projectId)}&days=7&refresh=1`
      : '/v1/admin/ci/overview?days=7&refresh=1'
  const fetchScope = scope === 'all' ? 'enumeration' : 'project'
  const page = usePageData<CiOverview>(path, { scope: fetchScope })
  const { data, reload } = page
  const live = useBackgroundLiveSync(livePath, fetchScope, reload)
  useVisiblePolling(live.sync, POLL_MS)

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
  const placementApps = useMemo(() => {
    const byId = new Map<string, string>()
    for (const r of data?.repos ?? []) if (!byId.has(r.projectId)) byId.set(r.projectId, r.projectName)
    return [...byId].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name))
  }, [data])
  // /ci#ci-placement (Connect's "CI settings" link) opens Settings, then scrolls there.
  useScrollToHash(!!data && !empty)

  // A count on a tab is the thing that view is for: jobs waiting now, jobs the
  // test machine stopped, changes that would speed CI up.
  // Counts match what the view shows: advice as its grouped cards, not raw items.
  const waitingNow = useMemo(() => (data ? buildCiQueue(data.jobs, Date.now()).waiting.length : 0), [data])
  const adviceCards = useMemo(() => (data ? groupCiAdvice(data.advice).length : 0), [data])
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const tabs = CI_VIEWS.map((v) => {
    const stopped = data?.stats.infraFailures ?? 0
    const [badge, badgeLabel] =
      v.id === 'now'
        ? [waitingNow, plural(waitingNow, 'job waiting for a test machine', 'jobs waiting for a test machine')]
        : v.id === 'machines'
          ? [stopped, plural(stopped, 'job the test machine stopped', 'jobs the test machine stopped')]
          : v.id === 'cost'
            ? [adviceCards, plural(adviceCards, 'change that would speed CI up', 'changes that would speed CI up')]
            : [0, '']
    return { to: viewHref(v.id), label: v.label, badge: badge > 0 ? badge : undefined, badgeLabel, match: () => view === v.id }
  })

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-ci">
      <PageHeaderBar
        title="CI runners"
        icon={<IconGauge />}
        description="Where your tests run, how long they wait, and what slows them down."
        helpTitle="About CI runners"
        helpWhatIsIt="Every fix Mushi Mushi opens is tested by your CI before it can merge. This page shows the machines that run those tests, the jobs waiting for one, and why your fixes take as long as they do to land."
        helpHowToUse="Start with the queue: a long Waiting column means too few machines. A job marked “Test machine stopped” was not a code failure; re-run it. Speed it up lists changes with the evidence behind each one."
      >
        <UpdatedAgo at={data?.refreshedAt ?? data?.generatedAt ?? null} validating={(live.syncing || page.isValidating) && !page.loading} />
        <Btn size="sm" variant="ghost" onClick={() => void live.sync()} disabled={live.syncing} title="Read the latest jobs from GitHub now">
          Refresh
        </Btn>
        {projectId && (
          <SegmentedControl<Scope> value={scope} options={SCOPE_OPTIONS} onChange={setScopeChoice} ariaLabel="Which apps" size="sm" />
        )}
        {/* The settings are their own view (ADR 0037 keeps them off the first screen); one click gets there. */}
        {data && !empty && view !== 'settings' && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => openView('settings')}
            title="Where CI runs, checks on fix pull requests, and GitHub-hosted time limits"
            data-testid="ci-settings-jump"
          >
            CI settings
          </Btn>
        )}
      </PageHeaderBar>

      {page.error && <PageLoadError error={page.error} resource="CI runners" endpoint={path} onRetry={reload} />}
      {page.loading && !data && <Loading text="Reading your CI…" />}

      {data && !empty && <TabbedSubNav ariaLabel="CI runners views" tabs={tabs} />}

      <PagePosture
        slots={[
          {
            id: 'ci-permissions',
            priority: POSTURE_PRIORITY.status,
            // Without Actions: read nothing here works, so that one shows everywhere. Without
            // Administration: read only idle and offline runners are missing, so it shows
            // where runners are (Machines, Settings), not on top of Now (2026-11-06).
            show:
              notice != null &&
              (empty || data?.permissions.jobs === 'missing' || view === 'machines' || view === 'settings'),
            children: (
              <Callout tone="warn" label="GitHub access">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{notice}</span>
                  <a href={docsUrl('/operating/ci-runners#github-permissions')} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                    How to give Mushi Mushi access ↗
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
          description="Mushi Mushi shows runners once GitHub reports a job for this app's repositories, or once a machine that runs your tests reports in: run these two commands on it."
          hints={['mushi runner key', 'mushi runner hooks install --dir <runner dir>']}
          action={
            <Btn size="sm" variant="ghost" href={docsUrl('/operating/ci-runners')}>
              How to set up CI runners
            </Btn>
          }
        />
      )}

      {data && !empty && view === 'now' && (
        <>
          <CiSummary overview={data} />

          <Section title="Needs attention" id="ci-attention" icon={<IconAlertTriangle />}>
            <p className="mb-2 text-xs text-fg-muted">Jobs running longer than they usually take, what failed in the last 2 hours and why, and how long each app's queue is.</p>
            <CiAttention jobs={data.jobs} byJob={data.stats.byJob} />
          </Section>

          <Section title="Queue" id="ci-queue" icon={<IconQueue />}>
            <p className="mb-2 text-xs text-fg-muted">Every job for your fixes, from waiting for a machine to finished. Re-run a job the test machine stopped; open the fix for one that failed.</p>
            <CiQueueBoard jobs={data.jobs} fixLinks={fixLinks} focusJobId={focusJobId} />
          </Section>

          <Section title="Job times" id="ci-job-times" icon={<IconGauge />}>
            <p className="mb-2 text-xs text-fg-muted">Each job over the last {data.window.days} days, slowest first: how long it usually runs, its slow runs, the longest, how long it waits for a machine and how often it fails.</p>
            <CiJobTimes byJob={data.stats.byJob} days={data.window.days} />
          </Section>

          <Section title="Timeline" id="ci-timeline" icon={<IconClock />}>
            <p className="mb-2 text-xs text-fg-muted">One row per test machine. Gaps are idle time; striped bars are jobs waiting for a machine.</p>
            <CiTimeline jobs={data.jobs} />
          </Section>
        </>
      )}

      {data && !empty && view === 'machines' && (
        <>
          <Section title="Runner map" id="ci-map" icon={<IconNetwork />}>
            <p className="mb-2 text-xs text-fg-muted">Your machines, the runners on them, the repositories they serve, and the jobs waiting or running now. Click any card for its health and recent jobs.</p>
            <PanelErrorBoundary label="Runner map">
              <Suspense fallback={<Loading text="Loading the map…" />}>
                <CiRunnerMap overview={data} selectedId={selected} onSelect={onSelect} />
              </Suspense>
            </PanelErrorBoundary>
          </Section>

          <Section title="Stopped by the test machine" id="ci-infra" icon={<IconServerOff />}>
            <p className="mb-2 text-xs text-fg-muted">These jobs never finished testing. They are not code failures: re-run them.</p>
            <CiInfraFailures jobs={data.jobs} />
          </Section>
        </>
      )}

      {data && !empty && view === 'cost' && (
        <>
          <Section
            title="Speed it up"
            id="ci-advice"
            icon={<IconBolt />}
            action={<CiCostFixRollout />}
          >
            <p className="mb-2 text-xs text-fg-muted">Changes that would land your fixes sooner, each with the evidence and a copy-ready fix.</p>
            <CiAdviceList advice={data.advice} />
          </Section>

          <Section title="Slow jobs" id="ci-slow" icon={<IconGauge />}>
            <CiSlowJobs jobs={data.jobs} slowSteps={data.stats.slowSteps} />
          </Section>

          <Section title="Cost and speed" id="ci-cost" icon={<IconCost />}>
            <PanelErrorBoundary label="Cost and speed">
              <CiCostSection projectId={projectId} scope={scope} />
            </PanelErrorBoundary>
          </Section>
        </>
      )}

      {data && !empty && view === 'settings' && (
        <Section title="Where CI runs" id="ci-placement" icon={<IconSliders />}>
          <p className="mb-2 text-xs text-fg-muted">Move a repo's jobs between GitHub-hosted runners and your own machines through the one runner variable its workflows read. Every change is previewed, approved and watched.</p>
          <PanelErrorBoundary label="Where CI runs">
            <CiPlacementSection projectId={projectId} scope={scope} apps={placementApps} onPickApp={pickApp} />
          </PanelErrorBoundary>
        </Section>
      )}

      {data && !empty && <CiNodeDrawer overview={data} nodeId={selected} onClose={() => setSelected(null)} onSelect={setSelected} />}
    </div>
  )
}
