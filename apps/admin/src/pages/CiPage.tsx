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
 * Debug in place (2026-11-19): every failed job (alert cards, What broke, the queue, the stopped
 * jobs, the job drawer) opens one drawer with the failing step, the screened log, a plain-English
 * cause (OpenAI, cached) and Re-run / Cancel / Send to CI repair (components/ci/CiJobDebug.tsx).
 * All apps with two or more apps groups the Now view by app, worst first.
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
import { IconAlertTriangle, IconBolt, IconClock, IconCost, IconGauge, IconNetwork, IconQueue, IconRefresh, IconServerOff, IconSliders } from '../components/icons'
import { CiStatusBoard, MACHINE_GRID, MachineCard, MissingLabelsLine, sharedMissingLabels } from '../components/ci/CiStatusBoard'
import { useReadTimedOut } from '../lib/ciReadTimeout'
import { CiNotChecked } from '../components/ci/CiNotChecked'
import { buildCiStatus } from '../lib/ciStatus'
import { CiJobTimes } from '../components/ci/CiJobTimes'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { ACTIVE_PROJECT_QUERY_PARAM, setActiveProjectIdSnapshot } from '../lib/activeProject'
import { PROJECT_SCOPE_QUERY_PARAM, setStoredProjectScopeMode, useProjectScope, useSetProjectScopeMode } from '../lib/projectScope'
import { CiQueueBoard } from '../components/ci/CiQueueBoard'
import { CiTimeline } from '../components/ci/CiTimeline'
import { CiNodeDrawer } from '../components/ci/CiNodeDrawer'
import { CiAdviceList, CiInfraFailures, CiSlowJobs } from '../components/ci/CiSections'
import { CiSummary } from '../components/ci/CiSummary'
import { CiAlertStrip } from '../components/ci/CiAlertStrip'
import { CiDebugProvider } from '../components/ci/CiJobDebug'
import { rankCiAlerts } from '../lib/ciAlerts'
import { ciAppCount } from '../lib/ciDebug'
import { CiHighlightProvider } from '../lib/ciHighlight'
import { CiCostSection } from '../components/ci/CiCostSection'
import { CiCostFixRollout } from '../components/ci/CiCostFixRollout'
import { CiPlacementSection } from '../components/ci/CiPlacementSection'
import { usePageData } from '../lib/usePageData'
import { apiFetch } from '../lib/supabase'
import { usePublishPageContext } from '../lib/pageContext'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { docsUrl } from '../lib/docsUrl'
import { LINK_ACCENT } from '../lib/chipTone'
import { useNow } from '../lib/useNow'
import type { CiOverview } from '../lib/ciTypes'
import { groupCiAdvice } from '../lib/ciAdvice'
import type { FixAttempt } from '../components/fixes/types'
import { appRunsOn, buildCiQueue, buildFixLinks, cleanCiOverview, formatSeconds, isCiOverviewEmpty, permissionsNotice } from '../lib/ciView'
import { useScrollToHash } from '../lib/useScrollToHash'

const CiRunnerMap = lazy(() => import('../components/ci/CiRunnerMap').then((m) => ({ default: m.CiRunnerMap })))

const POLL_MS = 30_000

// Now view on a wide main column: three tracks, "Right now" takes two, the week's summary one.
// grid-cols-1 below: an implicit column grows to its widest child (a 480 px table scrolled the
// whole page sideways at 390 px).
const NOW_GRID = 'grid-cols-1 @min-[96rem]:grid-cols-3'
const NOW_MAIN = '@min-[96rem]:col-span-2'
// Not sticky: a sticky grid item is bounded by the whole grid, not its row, so the week card
// floated over Job times and the Timeline while scrolling (2026-11-17).
const NOW_SIDE = '@min-[96rem]:col-span-1'
const NOW_FULL = '@min-[96rem]:col-span-3'
// Section hints stay a readable line on a wide shell.
const HINT = 'mb-2 max-w-[80ch] text-xs text-fg-muted'

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

/**
 * "Updated 12 s ago", ticking. While a sync runs, the Refresh button shows the spinner and a
 * polite live region says so once; the timestamp itself is never announced (it ticks every 5 s).
 * A loose "Updating…" used to replace it beside the button (owner, 2026-11-14).
 */
function UpdatedAgo({ at, validating }: { at: string | null; validating: boolean }) {
  const now = useNow(5_000)
  const secs = at ? Math.max(0, Math.round((now - Date.parse(at)) / 1000)) : null
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {validating ? 'Updating CI runners' : ''}
      </span>
      {secs != null && (
        <span className="text-2xs text-fg-muted tabular-nums" data-testid="ci-updated-ago">
          Updated {formatSeconds(secs)} ago
        </span>
      )}
    </>
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
  const { reload } = page
  // Job names without unresolved `${{ }}` expressions, once for every panel (round 3).
  const data = useMemo(() => (page.data ? cleanCiOverview(page.data) : page.data), [page.data])
  const live = useBackgroundLiveSync(livePath, fetchScope, reload)
  useVisiblePolling(live.sync, POLL_MS)
  // Never an endless "Reading your CI…" (390 All apps, 2026-11-18): after 10 s, "not checked" + Retry.
  const firstRead = useReadTimedOut(page.loading && !data && !page.error)

  // "Mushi fix" links for jobs on a fix's PR (this app only).
  const fixes = usePageData<{ fixes: FixAttempt[] }>(scope === 'project' && projectId ? `/v1/admin/fixes?limit=100&project_id=${encodeURIComponent(projectId)}` : null)
  const fixLinks = useMemo(() => buildFixLinks(fixes.data?.fixes ?? []), [fixes.data])

  const [selected, setSelected] = useState<string | null>(null)
  // The runner map is the advanced view: it mounts only when opened.
  const [mapOpen, setMapOpen] = useState(false)
  const onSelect = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), [])

  const stats = data?.stats
  usePublishPageContext({
    route: '/ci',
    title: 'CI runners',
    summary: stats
      ? `${(stats.windowJobs ?? stats.jobs).toLocaleString()} jobs in ${data.window.days} days · wait p95 ${formatSeconds(stats.queueP95s)} · ${stats.windowJobs != null && stats.hourly ? stats.hourly.reduce((n, h) => n + h.infraFailures, 0) : stats.infraFailures} test machine failures`
      : page.error
        ? "CI runners couldn't load"
        : 'Loading CI runners',
    questions: ['Why are my fixes slow to land?', 'Which runner keeps failing?', 'How do I make CI faster?', 'What does my CI cost, and would my own machine be cheaper?'],
  })

  const notice = data ? permissionsNotice(data.permissions) : null
  const empty = data ? isCiOverviewEmpty(data) : false
  // Every machine, busy first, for the Machines view (same placement as the Now board).
  const machinesAll = useMemo(() => (data ? buildCiStatus(data, Date.now()).allMachines : []), [data])
  const machinesMissing = useMemo(() => sharedMissingLabels(machinesAll), [machinesAll])
  // The "What's wrong" strip ranks from the same status the board shows, refreshed with the clock.
  const now = useNow(30_000)
  const status = useMemo(() => (data ? buildCiStatus(data, now) : null), [data, now])
  // Ranked once: the strip shows them, and with All apps each lands under its app.
  const alerts = useMemo(() => (data && status ? rankCiAlerts(data, status, now) : []), [data, status, now])
  // Grouping by app helps only with two or more apps (owner, 2026-11-19: "group the data of each app").
  const byApp = scope === 'all' && !!data && ciAppCount(data) >= 2
  const topAlerts = useMemo(() => (byApp ? alerts.filter((a) => a.projectId == null) : alerts), [byApp, alerts])
  const placementApps = useMemo(() => {
    const byId = new Map<string, string>()
    for (const r of data?.repos ?? []) if (!byId.has(r.projectId)) byId.set(r.projectId, r.projectName)
    // Where each app's jobs ran this window, for the mark on its chip.
    const runsOn = appRunsOn(data?.jobs ?? [])
    return [...byId].map(([id, name]) => ({ id, name, runsOn: runsOn.get(id) ?? null })).sort((x, y) => x.name.localeCompare(y.name))
  }, [data])
  // App names for repo slugs on Speed and cost ("help-her-take-photo" read as a repo, not an app; round 3).
  const repoNames = useMemo(() => new Map((data?.repos ?? []).map((r) => [r.repo.toLowerCase(), r.projectName] as const)), [data])
  // /ci#ci-placement (Connect's "CI settings" link) opens Settings, then scrolls there.
  useScrollToHash(!!data && !empty)

  // A count on a tab is the thing that view is for: jobs waiting now, jobs the
  // test machine stopped, changes that would speed CI up.
  // Counts match what the view shows: advice as its grouped cards, not raw items.
  const waitingNow = useMemo(() => (data ? buildCiQueue(data.jobs, Date.now()).waiting.length : 0), [data])
  // Waiting and running jobs are listed once, under "Right now"; the queue holds the finished ones.
  // A `?job=` deep link to a live job still opens it as a card in the queue.
  const focusLive = useMemo(
    () => !!focusJobId && !!data && (() => {
      const q = buildCiQueue(data.jobs, Date.now())
      return [...q.waiting, ...q.running].some((j) => j.id === focusJobId)
    })(),
    [focusJobId, data],
  )
  const adviceCards = useMemo(() => (data ? groupCiAdvice(data.advice).length : 0), [data])
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const tabs = CI_VIEWS.map((v) => {
    const stopped = data?.stats.infraFailures ?? 0
    const [badge, badgeLabel]: [number | string, string] =
      v.id === 'now'
        ? [waitingNow, plural(waitingNow, 'job waiting for a test machine', 'jobs waiting for a test machine')]
        : v.id === 'machines'
          ? // "7" beside "Machines" read as seven machines while three were listed (2026-11-18): say what it counts.
            [stopped > 0 ? `${stopped} stopped` : 0, plural(stopped, 'job the test machine stopped', 'jobs the test machine stopped')]
          : v.id === 'cost'
            ? [adviceCards, plural(adviceCards, 'change that would speed CI up', 'changes that would speed CI up')]
            : [0, '']
    const shown = typeof badge === 'string' ? badge : badge > 0 ? badge : undefined
    return { to: viewHref(v.id), label: v.label, badge: shown, badgeLabel, match: () => view === v.id }
  })

  return (
    <CiDebugProvider onChanged={() => void live.sync()}>
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
        {/* Icon buttons: the icon says what it does, the tooltip and label say it in words. */}
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => void live.sync()}
          aria-label="Refresh"
          aria-busy={((live.syncing || page.isValidating) && !page.loading) || undefined}
          title="Read the latest jobs from GitHub now"
        >
          <IconRefresh size={14} className={(live.syncing || page.isValidating) && !page.loading ? 'motion-safe:animate-spin' : ''} />
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
            title="CI settings: where CI runs, checks on fix pull requests, and GitHub-hosted time limits"
            aria-label="CI settings"
            data-testid="ci-settings-jump"
          >
            <IconSliders size={14} />
          </Btn>
        )}
      </PageHeaderBar>

      {page.error && <PageLoadError error={page.error} resource="CI runners" endpoint={path} onRetry={reload} />}
      {page.loading && !data && !page.error && !firstRead.timedOut && <Loading text="Reading your CI…" />}
      {!data && !page.error && firstRead.timedOut && (
        <CiNotChecked
          what="CI runners"
          testId="ci-not-checked"
          onRetry={() => {
            firstRead.restart()
            reload()
          }}
        />
      )}

      {data && !empty && <TabbedSubNav ariaLabel="CI runners views" tabs={tabs} />}

      {/* Problems first: the jobs the test machine stopped sit above the GitHub-access banner (2026-11-18). */}
      {data && !empty && view === 'machines' && (
        <Section title="Stopped by the test machine" id="ci-infra" icon={<IconServerOff />}>
          <CiInfraFailures jobs={data.jobs} />
        </Section>
      )}

      <PagePosture
        slots={[
          {
            id: 'ci-permissions',
            priority: POSTURE_PRIORITY.status,
            // Without Actions: read nothing here works, so that one shows everywhere. Without
            // Administration: read only idle and offline runners are missing, so it shows
            // where runners are (Machines, Settings), not on top of Now (2026-11-06).
            // Once, on Machines (round 3: it sat on Settings too, saying "machines show below" over
            // a page without them). Neutral: a missing read is a gap to close, not a failure.
            show: notice != null && (empty || data?.permissions.jobs === 'missing' || view === 'machines'),
            children: (
              <Callout tone={data?.permissions.jobs === 'missing' ? 'warn' : 'neutral'} label="GitHub access">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{notice}</span>
                  <a href={docsUrl('/operating/ci-runners#github-permissions')} target="_blank" rel="noopener noreferrer" className={`font-medium ${LINK_ACCENT}`}>
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
        // Worst first (2026-11-17): what is wrong, then what is happening now and this week, then
        // the queue, the timeline and the job times. Pointing at a problem, an app, a job or a
        // machine lights the same one in every panel (lib/ciHighlight.tsx).
        // On a wide desktop (main column ≥ 96rem) "Right now" and the week sit side by side; the
        // rest stays full width, because their lanes and time axes use every pixel. Container
        // query, not viewport: the sidebar can be open or closed. The container is the wrapper:
        // a container query never matches the container element itself.
        <CiHighlightProvider>
        {status && (
          <CiAlertStrip
            overview={data}
            status={status}
            now={now}
            alerts={topAlerts}
            // With All apps the app cards sit in their app's group below: "Nothing needs you" over them would be wrong.
            emptyText={byApp && alerts.length > 0 ? null : 'Nothing needs you'}
          />
        )}
        <div className="@container">
        <div className={`grid items-start gap-4 ${NOW_GRID}`} data-testid="ci-now-grid">
          <Section title="Right now" id="ci-attention" icon={<IconAlertTriangle />} className={`ci-rise ${NOW_MAIN}`}>
            <CiStatusBoard overview={data} fixLinks={fixLinks} groupByApp={byApp} alerts={alerts} onOpenApp={pickApp} />
          </Section>

          <Section title="Last 7 days" id="ci-week" icon={<IconGauge />} className={`ci-rise ${NOW_SIDE}`}>
            <CiSummary overview={data} />
          </Section>

          <Section title={focusLive ? 'Queue' : 'Finished jobs'} id="ci-queue" icon={<IconQueue />} className={`ci-rise ${NOW_FULL}`}>
            {/* The header, the filter and the cards say what this is; no intro restating them (round 3). */}
            {focusLive && <p className={HINT}>Every job for your fixes, from waiting for a machine to finished.</p>}
            <CiQueueBoard jobs={data.jobs} fixLinks={fixLinks} focusJobId={focusJobId} showLive={focusLive} />
          </Section>

          <Section title="Timeline" id="ci-timeline" icon={<IconClock />} className={`ci-rise ${NOW_FULL}`}>
            <CiTimeline jobs={data.jobs} />
          </Section>

          <Section title="Job times" id="ci-job-times" icon={<IconGauge />} className={`ci-rise ${NOW_FULL}`}>
            <CiJobTimes byJob={data.stats.byJob} days={data.window.days} />
          </Section>
        </div>
        </div>
        </CiHighlightProvider>
      )}

      {data && !empty && view === 'machines' && (
        <>
          <Section title="Machines" id="ci-machines" icon={<IconNetwork />}>
            <div className="@container">
              <ul className={`grid gap-2 ${MACHINE_GRID}`} data-testid="ci-machines-all">
                {machinesAll.map((m) => (
                  <MachineCard key={m.id} m={m} sharedMissing={machinesMissing} />
                ))}
              </ul>
              <MissingLabelsLine shared={machinesMissing} />
            </div>
          </Section>

          <Section title="Runner map (advanced)" id="ci-map" icon={<IconNetwork />}>
            <details onToggle={(e) => setMapOpen((e.currentTarget as HTMLDetailsElement).open)} open={mapOpen} data-testid="ci-map-disclosure">
              <summary className="cursor-pointer text-xs text-fg-secondary">
                Show every runner, the repositories it serves and the jobs on it, as a diagram
              </summary>
              {mapOpen && (
                <div className="mt-2">
                  <PanelErrorBoundary label="Runner map">
                    <Suspense fallback={<Loading text="Loading the map…" />}>
                      <CiRunnerMap overview={data} selectedId={selected} onSelect={onSelect} />
                    </Suspense>
                  </PanelErrorBoundary>
                </div>
              )}
            </details>
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
            <p className={HINT}>Changes that would land your fixes sooner, each with the evidence and a copy-ready fix.</p>
            <CiAdviceList advice={data.advice} />
          </Section>

          <Section title="Slow jobs" id="ci-slow" icon={<IconGauge />}>
            <CiSlowJobs jobs={data.jobs} slowSteps={data.stats.slowSteps} repoNames={repoNames} />
          </Section>

          <Section title="Cost and speed" id="ci-cost" icon={<IconCost />}>
            <PanelErrorBoundary label="Cost and speed">
              <CiCostSection projectId={projectId} scope={scope} machines={machinesAll} repoNames={repoNames} />
            </PanelErrorBoundary>
          </Section>
        </>
      )}

      {data && !empty && view === 'settings' && (
        <Section title="Where CI runs" id="ci-placement" icon={<IconSliders />}>
          <p className={HINT}>Move a repo's jobs between GitHub-hosted runners and your own machines through the one runner variable its workflows read. Every change is previewed, approved and watched.</p>
          <PanelErrorBoundary label="Where CI runs">
            <CiPlacementSection projectId={projectId} scope={scope} apps={placementApps} onPickApp={pickApp} machines={machinesAll} />
          </PanelErrorBoundary>
        </Section>
      )}

      {data && !empty && <CiNodeDrawer overview={data} nodeId={selected} onClose={() => setSelected(null)} onSelect={setSelected} />}
    </div>
    </CiDebugProvider>
  )
}
