/**
 * FILE: apps/admin/src/pages/TimelinePage.tsx
 * PURPOSE: The app's iteration Timeline (Plan 025 P1, ADR 0072): how the app
 *          got better, release by release. A rail of releases (or UX runs,
 *          when the app has no releases), what each closed, improved and
 *          cost; each screen's pinned screenshot per release as a filmstrip
 *          with a before/after comparison; and what changed for users in the
 *          last 30 days. No model call on this page.
 *
 * Data: GET  /v1/admin/projects/:pid/timeline
 *       POST /v1/admin/projects/:pid/timeline/baselines   (Pin current screens)
 *       PATCH /v1/admin/projects/:pid/timeline/settings   (how many releases to keep, auto-pin on publish)
 *
 * Roles: a viewer sees Pin, Keep forever and the settings disabled with the
 * reason; run links open /ux-runs only for an operator (ADR 0072).
 */

import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Badge, Btn, Card, EmptyState, Input, Skeleton, StatCard, Toggle } from '../components/ui'
import { formatRelative } from '../components/ui/metrics'
import { PageLoadError } from '../components/PageLoadError'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { TimelineRail } from '../components/timeline/TimelineRail'
import { ScreenHistory } from '../components/timeline/ScreenHistory'
import { canEditTimeline, PinButton, RunLinks, VIEWER_EDIT_HINT } from '../components/timeline/TimelineControls'
import { useActiveOrgRole } from '../lib/useActiveOrgRole'
import { useSetupStatus } from '../lib/useSetupStatus'
import { requestOpenProjectSwitcher, useProjectScopeMode } from '../lib/projectScope'
import { useEntitlements } from '../lib/useEntitlements'
import { apiFetchMutate } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { scoreTone } from '../lib/uxScorecard'
import { formatCost, judgeLine, reuseShare, scoreDelta, seriesOf, suggestVersion, type TimelineData, type TimelinePoint } from '../lib/timeline'

const KEEP_OPTIONS = [12, 24, 48, 96] as const

export function TimelinePage() {
  const projectId = useActiveProjectId()
  if (!projectId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar title="Timeline" />
        <EmptyState title="No project selected" description="Switch to a project at the top to see how its screens changed release by release." />
      </div>
    )
  }
  return <ProjectTimeline key={projectId} projectId={projectId} />
}

/**
 * A timeline is one app's releases and screens, so "All apps" cannot combine
 * it. Under All apps the header names the app and an empty timeline offers
 * the switcher: it used to show the last app you opened, empty, with nothing
 * saying which (2026-11-27).
 */
function ProjectTimeline({ projectId }: { projectId: string }) {
  const setup = useSetupStatus(projectId)
  const appName = setup.activeProject?.project_name ?? null
  const allApps = useProjectScopeMode() === 'all'
  const path = `/v1/admin/projects/${projectId}/timeline`
  const q = usePageData<TimelineData>(path)
  const d = q.data
  const points = useMemo(() => d?.points ?? [], [d])
  const [picked, setPicked] = useState<number | null>(null)
  const selected = picked ?? Math.max(0, points.length - 1)
  const point = points[selected] ?? null
  const [screen, setScreen] = useState<string | null>(null)
  const surfaces = d?.surfaces ?? []
  const shownScreen = screen ?? surfaces[0]?.key ?? null
  const { role } = useActiveOrgRole()
  const canEdit = canEditTimeline(role)
  const { isOperator } = useEntitlements()
  const screensRef = useRef<HTMLElement>(null)
  const showScreens = () => screensRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })

  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="Timeline"
        projectScope={appName}
        helpTitle="What is the Timeline?"
        helpWhatIsIt="How your app got better, release by release: the bugs each release fixed, the screens your coding agent improved, the scorecard's average, what the AI checks cost, and a screenshot of every screen for each release so you can drag between the before and the after."
        helpHowToUse="Run mushi-ux scorecard --sync (or a UX run) on your computer, then press Pin current screens to keep this release's screenshots. Pick a release on the rail to see what it closed; pick a screen to compare its releases. Pinned shots are kept for the last releases you choose below; mark one Keep forever to keep it beyond that."
        helpFlowPath="/timeline"
      />

      {q.error && <PageLoadError error={q.error} resource="the timeline" endpoint={path} onRetry={q.reload} />}
      {q.loading && !d && <TimelineSkeleton />}

      {d && points.length === 0 && surfaces.length === 0 && (
        <EmptyState
          title={appName ? `Nothing on ${appName}'s timeline yet` : 'Nothing on the timeline yet'}
          description={`${allApps ? 'The timeline shows one app at a time. ' : ''}Score your app's pages on your computer with mushi-ux scorecard --url <your app> --profile-dir <signed-in browser profile> --sync, or run a UX run. Each run lands here; pin its screenshots to a release to start the before and after.`}
          action={
            allApps ? (
              <Btn size="sm" variant="ghost" onClick={requestOpenProjectSwitcher} data-testid="timeline-switch-app">
                Show another app's timeline
              </Btn>
            ) : undefined
          }
        />
      )}

      {d && (points.length > 0 || surfaces.length > 0) && (
        <>
          <PagePosture
            slots={[
              {
                priority: POSTURE_PRIORITY.status,
                show: true,
                children: <MonthCards data={d} />,
              },
            ]}
          />

          <MonthChanges data={d} />

          <section aria-labelledby="tl-rail" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="tl-rail" className="text-sm font-semibold text-fg">
                {d.rail === 'releases' ? 'Releases' : 'UX runs'}
              </h2>
              {d.rail === 'runs' && <p className="text-2xs text-fg-muted">No releases yet, so each UX run is a stop. Publish a release to group them.</p>}
            </div>
            <TimelineRail points={points} selected={selected} onSelect={setPicked} />
            {point && <PointDetail projectId={projectId} point={point} points={points} onPinned={q.reload} canEdit={canEdit} isOperator={isOperator} onShowScreens={showScreens} />}
          </section>

          <section ref={screensRef} aria-labelledby="tl-screens" className="flex scroll-mt-4 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="tl-screens" className="text-sm font-semibold text-fg">
                Screens
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <AutoPinSetting projectId={projectId} value={d.settings.auto_pin === true} canEdit={canEdit} onSaved={q.reload} />
                <KeepSetting projectId={projectId} value={d.settings.keep_releases} canEdit={canEdit} onSaved={q.reload} />
              </div>
            </div>
            {surfaces.length === 0 ? (
              <EmptyState title="No screenshots pinned yet" description="Pin current screens on a release above. Every screen your last runs captured gets one shot for that release." />
            ) : (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <ul aria-label="Screens" className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:w-72 lg:grid-cols-1">
                  {surfaces.map((s) => {
                    const delta = scoreDelta(s.first_score, s.latest_score)
                    const on = s.key === shownScreen
                    return (
                      <li key={s.key}>
                        <Card interactive onClick={() => setScreen(s.key)} className={`flex flex-col gap-1.5 p-2 ${on ? 'border-brand/40 bg-surface-raised' : ''}`}>
                          {s.thumb_url ? (
                            <img src={s.thumb_url} alt="" loading="lazy" className="aspect-video w-full rounded-sm border border-edge-subtle object-cover object-top" />
                          ) : (
                            <span className="block aspect-video w-full rounded-sm bg-surface-raised" />
                          )}
                          <span className="flex items-center justify-between gap-1">
                            <span className="truncate text-xs font-medium text-fg">{s.label}</span>
                            {s.latest_score != null && <Badge tone={scoreTone(s.latest_score)}>{s.latest_score}/10</Badge>}
                          </span>
                          <span className="flex items-center gap-1.5 text-2xs text-fg-muted">
                            <span>
                              {new Set(s.frames.map((f) => f.version)).size} release{new Set(s.frames.map((f) => f.version)).size === 1 ? '' : 's'}
                            </span>
                            {delta && <Badge tone={delta.startsWith('+') ? 'ok' : 'warn'}>{delta}</Badge>}
                          </span>
                        </Card>
                      </li>
                    )
                  })}
                </ul>
                <div className="min-w-0 flex-1">{shownScreen && <ScreenHistory key={shownScreen} projectId={projectId} surfaceKey={shownScreen} canEdit={canEdit} isOperator={isOperator} />}</div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the timeline">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-md" />
        ))}
      </div>
      <div className="flex gap-2 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 w-36 shrink-0 rounded-md" />
        ))}
      </div>
      <Skeleton className="aspect-video w-full rounded-md" />
    </div>
  )
}

/** The last 30 days in four numbers, with the score and cost trend across the rail. */
function MonthCards({ data }: { data: TimelineData }) {
  const m = data.month
  const scoreTrend = seriesOf(data.points, 'score')
  const costTrend = seriesOf(data.points, 'cost')
  const share = reuseShare(m.judged, m.cached)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Bugs fixed, 30 days" value={m.reports_closed} detail={`${m.releases} release${m.releases === 1 ? '' : 's'}`} />
      <StatCard label="Screens improved" value={m.screens_improved} detail={`${m.runs} run${m.runs === 1 ? '' : 's'} this month`} />
      <StatCard
        label="Scorecard average"
        value={scoreTrend.length ? `${scoreTrend[scoreTrend.length - 1]}/10` : '–'}
        detail={scoreTrend.length > 1 ? `from ${scoreTrend[0]}/10` : 'one run so far'}
        trend={scoreTrend.length > 1 ? scoreTrend : undefined}
      />
      <StatCard
        label="AI cost, 30 days"
        value={formatCost(m.cost_usd)}
        detail={share != null ? `${share}% of scores reused at no cost` : 'no AI checks this month'}
        hint="What the UX checks spent on model calls. A page that has not changed reuses its earlier score instead of a new call."
        trend={costTrend.length > 1 ? costTrend : undefined}
      />
    </div>
  )
}

/** "What changed for users this month": the bugs fixed and the screens whose score moved most. */
function MonthChanges({ data }: { data: TimelineData }) {
  const m = data.month
  if (!m.top_reports.length && !m.movers.length) return null
  return (
    <section aria-labelledby="tl-month" className="flex flex-col gap-2">
      <h2 id="tl-month" className="text-sm font-semibold text-fg">
        What changed for your users this month
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {m.top_reports.length > 0 && (
          <Card className="flex flex-col gap-1.5 p-3">
            <h3 className="text-xs font-semibold text-fg">Fixed</h3>
            <ul className="flex flex-col gap-1">
              {m.top_reports.map((r) => (
                <li key={r.id} className="truncate text-xs">
                  <Link className="text-brand underline underline-offset-2" to={`/reports/${r.id}`}>
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
            {m.reports_closed > m.top_reports.length && <p className="text-2xs text-fg-muted">and {m.reports_closed - m.top_reports.length} more</p>}
          </Card>
        )}
        {m.movers.length > 0 && (
          <Card className="flex flex-col gap-1.5 p-3">
            <h3 className="text-xs font-semibold text-fg">Screens that moved</h3>
            <ul className="flex flex-col gap-1">
              {m.movers.map((mv) => (
                <li key={mv.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-fg">{mv.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Badge tone={scoreTone(mv.from)}>{mv.from}</Badge>
                    <span aria-hidden className="text-fg-muted">→</span>
                    <span className="sr-only">to</span>
                    <Badge tone={scoreTone(mv.to)}>{mv.to}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </section>
  )
}

/** The picked stop: what it closed, which runs it holds, what they cost, and Pin current screens. */
function PointDetail({
  projectId,
  point,
  points,
  onPinned,
  canEdit,
  isOperator,
  onShowScreens,
}: {
  projectId: string
  point: TimelinePoint
  points: TimelinePoint[]
  onPinned: () => void
  canEdit: boolean
  isOperator: boolean
  onShowScreens: () => void
}) {
  const [version, setVersion] = useState(() => suggestVersion(points, new Date()))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const isRelease = point.kind === 'release'
  const judged = judgeLine(point.judged, point.cached)

  const pin = async () => {
    setBusy(true)
    setNote(null)
    const releaseId = isRelease ? point.id.replace(/^release:/, '') : null
    const res = await apiFetchMutate<{ pinned: number; failed: number; screens: number; version: string }>(`/v1/admin/projects/${projectId}/timeline/baselines`, {
      method: 'POST',
      body: JSON.stringify(releaseId ? { release_id: releaseId } : { version: version.trim() }),
    })
    setBusy(false)
    if (res.ok && res.data) {
      setNote({ ok: true, text: `Pinned ${res.data.pinned} shot${res.data.pinned === 1 ? '' : 's'} of ${res.data.screens} screen${res.data.screens === 1 ? '' : 's'} to ${res.data.version}${res.data.failed ? `; ${res.data.failed} could not be copied` : ''}.` })
      onPinned()
    } else {
      setNote({ ok: false, text: res.error?.message ?? 'Not pinned.' })
    }
  }

  return (
    <Card key={point.id} className="flex flex-col gap-3 p-3 motion-safe:animate-mushi-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">
            {point.label}
            {point.title && point.title !== point.label && <span className="font-normal text-fg-secondary"> · {point.title}</span>}
          </p>
          <p className="text-2xs text-fg-muted">
            {formatRelative(point.at)}
            {point.status && point.kind === 'release' && point.status !== 'published' && ' · draft'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {point.score != null && <Badge tone={scoreTone(Math.round(point.score))}>{point.score}/10</Badge>}
          <Badge tone="neutral" title={judged ?? undefined}>
            {formatCost(point.cost_usd)} AI cost
          </Badge>
          {point.baselines > 0 && <Badge tone="brand">{point.baselines} screens pinned</Badge>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Bugs fixed</span>
          {point.reports.length ? (
            <ul className="flex flex-col gap-0.5">
              {point.reports.map((r) => (
                <li key={r.id} className="truncate text-xs">
                  <Link className="text-brand underline underline-offset-2" to={`/reports/${r.id}`}>
                    {r.title}
                  </Link>
                </li>
              ))}
              {point.reports_closed > point.reports.length && <li className="text-2xs text-fg-muted">and {point.reports_closed - point.reports.length} more</li>}
            </ul>
          ) : (
            <span className="text-xs text-fg-secondary">None recorded</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Runs</span>
          <RunLinks runs={point.runs} isOperator={isOperator} onShowScreens={onShowScreens} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Screens</span>
          <span className="text-xs text-fg-secondary">
            {point.improved_screens ? `${point.improved_screens} improved by the UX loop` : 'No kept UX change'}
            {judged && <span className="block text-2xs text-fg-muted">Scores: {judged}</span>}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-edge-subtle pt-3">
        {!isRelease && (
          <div className="w-44">
            <Input label="Version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.4.0" maxLength={80} disabled={!canEdit} />
          </div>
        )}
        <PinButton
          label={isRelease ? `Pin current screens to ${point.label}` : 'Pin current screens'}
          canEdit={canEdit}
          busy={busy}
          disabled={!isRelease && !version.trim()}
          onPin={() => void pin()}
        />
        <span className="text-2xs text-fg-muted">Copies each screen's newest screenshot from your last runs. No AI call.</span>
      </div>
      {note && (
        <p role="status" className={`text-xs ${note.ok ? 'text-fg-secondary' : 'text-danger'}`}>
          {note.text}
        </p>
      )}
    </Card>
  )
}

/** How many releases of each screen to keep (pinned shots are kept beyond it). */
function KeepSetting({ projectId, value, canEdit, onSaved }: { projectId: string; value: number; canEdit: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = (KEEP_OPTIONS as readonly number[]).includes(value) ? KEEP_OPTIONS : [value, ...KEEP_OPTIONS]
  return (
    <label className="flex items-center gap-1.5 text-2xs text-fg-secondary" title={!canEdit ? VIEWER_EDIT_HINT : undefined}>
      <span>Keep shots of the last</span>
      <select
        className="rounded-sm border border-edge-subtle bg-surface px-1.5 py-0.5 text-xs text-fg"
        value={value}
        disabled={busy || !canEdit}
        onChange={async (e) => {
          setBusy(true)
          setError(null)
          const res = await apiFetchMutate<{ keep_releases: number }>(`/v1/admin/projects/${projectId}/timeline/settings`, {
            method: 'PATCH',
            body: JSON.stringify({ keep_releases: Number(e.target.value) }),
          })
          setBusy(false)
          if (res.ok) onSaved()
          else setError(res.error?.message ?? 'Not saved.')
        }}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span>releases per screen</span>
      {error && <span className="text-danger">{error}</span>}
    </label>
  )
}

/** Opt-in, off by default (ADR 0072): pin every screen's current shot when a release is published. */
function AutoPinSetting({ projectId, value, canEdit, onSaved }: { projectId: string; value: boolean; canEdit: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="flex items-center gap-1.5" title={!canEdit ? VIEWER_EDIT_HINT : "When you publish a release, pin each screen's newest screenshot to it. Same limits as Pin current screens; no AI call."}>
      <Toggle
        label="Pin on publish"
        checked={value}
        disabled={busy || !canEdit}
        onChange={async (next: boolean) => {
          setBusy(true)
          setError(null)
          const res = await apiFetchMutate<{ auto_pin: boolean }>(`/v1/admin/projects/${projectId}/timeline/settings`, {
            method: 'PATCH',
            body: JSON.stringify({ auto_pin: next }),
          })
          setBusy(false)
          if (res.ok) onSaved()
          else setError(res.error?.message ?? 'Not saved.')
        }}
      />
      {error && <span className="text-2xs text-danger">{error}</span>}
    </span>
  )
}
