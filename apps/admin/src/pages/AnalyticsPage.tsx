/**
 * FILE: apps/admin/src/pages/AnalyticsPage.tsx
 * PURPOSE: Users & Funnels — product analytics from `Mushi.track()` for the
 *          active project: event volume, funnels, next-step paths, people,
 *          and weekly retention.
 *
 * Data (all `{ ok, data }`, project resolved from the x-project-id header
 * like GET /v1/admin/activity):
 *   GET /v1/admin/events/summary?window=30
 *   GET /v1/admin/events/funnel?steps=a,b,c&window=7d&breakdown=prop&from=&to=
 *   GET /v1/admin/events/paths?from_event=&limit=
 *   GET /v1/admin/events/people?limit=&before=
 *   GET /v1/admin/events/retention?weeks=8&return_event=
 * Auth: jwtAuth. Nav: navRegistry 'nav:analytics', sectionId 'check'.
 *
 * Route is `/analytics` (not `/users`): `/users` is the operator-only signup
 * directory (UsersPage.tsx, superAdmin, docs/admin/users.mdx) and already
 * owns `nav:users`.
 *
 * Only the active tab's endpoint is fetched; the summary is always loaded
 * because it feeds the header stats, the funnel builder's event chips, and
 * the "no events yet" empty state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import {
  Badge,
  Btn,
  Card,
  CodeValue,
  DataTableCell,
  DataTableHead,
  EmptyState,
  FreshnessPill,
  RelativeTime,
  Section,
  SegmentedControl,
  SelectField,
  StatCard,
  StatGrid,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { BarSparkline, LineSparkline } from '../components/charts'
import { FunnelBars, type FunnelBarStep } from '../components/charts/FunnelBars'
import { FunnelBuilder } from '../components/FunnelBuilder'
import { IconGauge } from '../components/icons'
import {
  SIGNUP_ACTIVATED_PRESET,
  buildFunnelQuery,
  canRunFunnel,
  deleteSavedFunnel,
  emptyFunnel,
  loadSavedFunnels,
  newFunnelId,
  saveFunnel,
  type FunnelDefinition,
} from '../lib/funnelBuilder'

// ─── Types (server contract) ─────────────────────────────────────────────────

interface EventsSummary {
  window_days: number
  events_total: number
  persons: number
  identified: number
  anonymous: number
  events_per_day: Array<{ day: string; count: number }>
  top_events: Array<{ name: string; count: number; persons: number }>
}

interface FunnelResult {
  steps: FunnelBarStep[]
  breakdown: Array<{ value: string; steps: FunnelBarStep[] }>
}

interface PathsResult {
  from_event: string
  total: number
  next: Array<{ name: string; count: number; pct: number }>
}

interface Person {
  end_user_id: string | null
  external_user_id: string | null
  display_name: string | null
  first_seen_at: string
  last_seen_at: string
  event_count: number
  last_event: string | null
  traits: Record<string, unknown> | null
}

interface PeopleResult {
  people: Person[]
  next_before: string | null
}

interface RetentionResult {
  cohorts: Array<{ week_start: string; size: number; weeks: number[] }>
}

type TabId = 'overview' | 'funnels' | 'paths' | 'people' | 'retention'

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'funnels', label: 'Funnels' },
  { id: 'paths', label: 'Paths' },
  { id: 'people', label: 'People' },
  { id: 'retention', label: 'Retention' },
]

function isTab(value: string | null): value is TabId {
  return TABS.some((t) => t.id === value)
}

const SUMMARY_WINDOW = 30
const PEOPLE_PAGE = 50
const RETENTION_WEEKS = 8
const DOCS_URL = 'https://kensaur.us/mushi-mushi/docs/sdks/analytics'
const TRACK_SNIPPET = "Mushi.track('checkout_started', { plan: 'pro' })"

// ─── Page ────────────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const copy = usePageCopy('/analytics')
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const projectKey = setup.activeProject?.project_id ?? activeProjectId ?? 'default'
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: TabId = isTab(tabParam) ? tabParam : 'overview'

  const setTab = useCallback(
    (id: TabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const summary = usePageData<EventsSummary>(`/v1/admin/events/summary?window=${SUMMARY_WINDOW}`)
  const topEventNames = useMemo(() => (summary.data?.top_events ?? []).map((e) => e.name), [summary.data])
  const noEvents = Boolean(summary.data) && (summary.data?.events_total ?? 0) === 0

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-analytics">
      <PageHeaderBar
        title={copy?.title ?? 'Users & Funnels'}
        description={
          copy?.description ??
          'Product events from Mushi.track() — who does what, in which order, and who comes back.'
        }
        projectScope={projectName ?? undefined}
        icon={<IconGauge />}
        helpTitle={copy?.help?.title ?? 'About Users & Funnels'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Every Mushi.track() call from your app lands here as an event tied to a person (identified or anonymous). Build funnels from those events, see where people go next, browse people, and read weekly retention.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Measure signup → activation for your own product',
            'Find the step where people drop before they file a bug',
            'Check whether a release changed week-over-week retention',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Start on Funnels: pick events in order, choose a window, run. Save the ones you check weekly. Paths answers "what happens after X"; Retention groups people by first-seen week.'
        }
      >
        <FreshnessPill at={summary.lastFetchedAt} isValidating={summary.isValidating} />
        <Btn size="sm" variant="ghost" onClick={summary.reload} loading={summary.isValidating}>
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: Boolean(summary.data),
            children: summary.data ? (
              <StatGrid>
                <StatCard
                  label="Events"
                  value={fmt(summary.data.events_total)}
                  detail={`last ${summary.data.window_days}d`}
                />
                <StatCard
                  label="People"
                  value={fmt(summary.data.persons)}
                  detail={`${fmt(summary.data.identified)} identified`}
                />
                <StatCard
                  label="Anonymous"
                  value={fmt(summary.data.anonymous)}
                  detail={identifiedPct(summary.data)}
                />
                <StatCard
                  label="Distinct events"
                  value={String(summary.data.top_events.length)}
                  detail="event names seen"
                />
              </StatGrid>
            ) : null,
          },
        ]}
      />

      {summary.loading && !summary.data && (
        <div className="flex items-center justify-center py-16 text-fg-faint text-sm">Loading events…</div>
      )}
      {summary.error && (
        <PageLoadError
          error={summary.error}
          code={summary.errorCode}
          resource="events"
          endpoint={summary.errorEndpoint}
          requestId={summary.requestId}
          onRetry={summary.reload}
        />
      )}

      {summary.data && noEvents && <NoEventsYet />}

      {summary.data && !noEvents && (
        <>
          <SegmentedControl value={tab} onChange={setTab} options={TABS} ariaLabel="Users & Funnels sections" size="sm" wrap />
          {tab === 'overview' && <OverviewTab data={summary.data} />}
          {tab === 'funnels' && <FunnelsTab projectKey={projectKey} availableEvents={topEventNames} />}
          {tab === 'paths' && <PathsTab availableEvents={topEventNames} />}
          {tab === 'people' && <PeopleTab />}
          {tab === 'retention' && <RetentionTab availableEvents={topEventNames} />}
        </>
      )}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function NoEventsYet() {
  return (
    <EmptyState
      icon={<IconGauge />}
      title="No events yet"
      description="Call track() from your app once and this page fills in — event volume, funnels, paths, people, and retention. Events are tied to the same anonymous id the bug widget uses, so a person's reports and their product events line up."
      action={
        <div className="space-y-3">
          <CodeValue value={TRACK_SNIPPET} copyable />
          <p className="text-2xs text-fg-faint leading-relaxed">
            Browsers with Do Not Track or Global Privacy Control send nothing — no events, no anonymous id.
            With <span className="font-mono">consent: 'required'</span> the SDK buffers until you call{' '}
            <span className="font-mono">setConsent('granted')</span>.{' '}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
              Analytics SDK docs →
            </a>
          </p>
        </div>
      }
    />
  )
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: EventsSummary }) {
  const series = data.events_per_day ?? []
  const values = series.map((p) => p.count)
  const timestamps = series.map((p) => p.day)
  const maxCount = data.top_events[0]?.count ?? 0
  return (
    <div className="space-y-4">
      {values.length > 0 && (
        <Section title={`Events per day — last ${data.window_days}d`}>
          <LineSparkline values={values} timestamps={timestamps} height={64} showAxes showPeakLabel ariaLabel="Events per day" />
        </Section>
      )}
      <Section title="Top events">
        {data.top_events.length === 0 ? (
          <p className="text-xs text-fg-faint">No named events in this window.</p>
        ) : (
          <ol className="space-y-1.5">
            {data.top_events.map((e, i) => (
              <li key={e.name} className="flex items-center gap-3 text-xs">
                <span className="w-4 shrink-0 text-right text-fg-faint">{i + 1}</span>
                <span className="w-44 shrink-0 truncate font-mono text-fg-muted" title={e.name}>
                  {e.name}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
                  <div className="h-full rounded-full bg-brand/60" style={{ width: `${maxCount > 0 ? (e.count / maxCount) * 100 : 0}%` }} />
                </div>
                <span className="w-14 shrink-0 text-right tabular-nums text-fg-muted">{fmt(e.count)}</span>
                <span className="w-16 shrink-0 text-right tabular-nums text-fg-faint">{fmt(e.persons)} ppl</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}

// ─── Funnels ─────────────────────────────────────────────────────────────────

function FunnelsTab({ projectKey, availableEvents }: { projectKey: string; availableEvents: string[] }) {
  const [def, setDef] = useState<FunnelDefinition>(() => ({ ...emptyFunnel(), id: newFunnelId() }))
  const [saved, setSaved] = useState<FunnelDefinition[]>(() => loadSavedFunnels(projectKey))
  const [query, setQuery] = useState<string | null>(null)

  useEffect(() => {
    setSaved(loadSavedFunnels(projectKey))
  }, [projectKey])

  const result = usePageData<FunnelResult>(query ? `/v1/admin/events/funnel?${query}` : null)

  function run() {
    if (!canRunFunnel(def.steps)) return
    const next = buildFunnelQuery(def)
    if (next === query) result.reload()
    else setQuery(next)
  }

  return (
    <div className="space-y-4">
      <FunnelBuilder
        value={def}
        onChange={setDef}
        onRun={run}
        running={result.isValidating}
        availableEvents={availableEvents}
        saved={saved}
        onSave={(d) => {
          const persisted = d.id.startsWith('preset:') ? { ...d, id: newFunnelId() } : d
          setDef(persisted)
          setSaved(saveFunnel(projectKey, persisted))
        }}
        onLoad={(d) => setDef(d.id === SIGNUP_ACTIVATED_PRESET.id ? { ...d } : d)}
        onDelete={(id) => setSaved(deleteSavedFunnel(projectKey, id))}
      />

      {query && result.loading && !result.data && (
        <div className="flex items-center justify-center py-10 text-fg-faint text-sm">Running funnel…</div>
      )}
      {query && result.error && (
        <PageLoadError
          error={result.error}
          code={result.errorCode}
          resource="funnel"
          endpoint={result.errorEndpoint}
          requestId={result.requestId}
          onRetry={result.reload}
        />
      )}
      {result.data && (
        <Section
          title={def.name || 'Funnel'}
          freshness={{ at: result.lastFetchedAt, isValidating: result.isValidating }}
        >
          {result.data.steps.length === 0 ? (
            <p className="text-xs text-fg-faint">No one entered the first step in this range.</p>
          ) : (
            <FunnelBars steps={result.data.steps} />
          )}
          {result.data.breakdown?.length > 0 && (
            <div className="mt-4 space-y-4 border-t border-edge-subtle pt-4">
              <p className="text-xs font-semibold text-fg">
                By <span className="font-mono">{def.breakdown}</span>
              </p>
              {result.data.breakdown.map((b) => (
                <FunnelBars key={b.value} steps={b.steps} caption={b.value || '(empty)'} />
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ─── Paths ───────────────────────────────────────────────────────────────────

function PathsTab({ availableEvents }: { availableEvents: string[] }) {
  const [fromEvent, setFromEvent] = useState<string>(availableEvents[0] ?? '')
  useEffect(() => {
    if (!fromEvent && availableEvents[0]) setFromEvent(availableEvents[0])
  }, [availableEvents, fromEvent])

  const path = fromEvent ? `/v1/admin/events/paths?from_event=${encodeURIComponent(fromEvent)}&limit=12` : null
  const paths = usePageData<PathsResult>(path)

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SelectField label="What happens after…" id="paths-from-event" value={fromEvent} onChange={(e) => setFromEvent(e.target.value)}>
          {availableEvents.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </SelectField>
      </Card>
      {paths.loading && !paths.data && (
        <div className="flex items-center justify-center py-10 text-fg-faint text-sm">Tracing paths…</div>
      )}
      {paths.error && (
        <PageLoadError error={paths.error} code={paths.errorCode} resource="paths" endpoint={paths.errorEndpoint} requestId={paths.requestId} onRetry={paths.reload} />
      )}
      {paths.data && (
        <Section
          title={`Next step after ${paths.data.from_event}`}
          freshness={{ at: paths.lastFetchedAt, isValidating: paths.isValidating }}
        >
          {paths.data.next.length === 0 ? (
            <p className="text-xs text-fg-faint">Nothing follows this event within a session yet.</p>
          ) : (
            <>
              <BarSparkline
                values={paths.data.next.map((n) => n.count)}
                xLabels={paths.data.next.map((n) => n.name)}
                barTitles={paths.data.next.map((n) => `${n.name}: ${fmt(n.count)} (${n.pct.toFixed(1)}%)`)}
                height={72}
                showAxes
                showBarLabels
                ariaLabel={`Next events after ${paths.data.from_event}`}
              />
              <ol className="mt-3 space-y-1">
                {paths.data.next.map((n, i) => (
                  <li key={n.name} className="flex items-center gap-3 text-xs">
                    <span className="w-4 shrink-0 text-right text-fg-faint">{i + 1}</span>
                    <span className="flex-1 truncate font-mono text-fg-muted">{n.name}</span>
                    <span className="w-14 text-right tabular-nums text-fg">{fmt(n.count)}</span>
                    <span className="w-14 text-right tabular-nums text-fg-faint">{n.pct.toFixed(1)}%</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-2xs text-fg-faint">
                {fmt(paths.data.total)} sessions had <span className="font-mono">{paths.data.from_event}</span>.
              </p>
            </>
          )}
        </Section>
      )}
    </div>
  )
}

// ─── People ──────────────────────────────────────────────────────────────────

function PeopleTab() {
  const [before, setBefore] = useState<string | null>(null)
  const [pages, setPages] = useState<Person[]>([])
  const path = `/v1/admin/events/people?limit=${PEOPLE_PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`
  const people = usePageData<PeopleResult>(path)

  // Append pages as the cursor advances; a fresh first page replaces.
  useEffect(() => {
    if (!people.data) return
    setPages((prev) => (before ? [...prev, ...people.data!.people] : people.data!.people))
  }, [people.data, before])

  const rows = before ? pages : (people.data?.people ?? [])

  return (
    <div className="space-y-4">
      {people.loading && !people.data && (
        <div className="flex items-center justify-center py-10 text-fg-faint text-sm">Loading people…</div>
      )}
      {people.error && (
        <PageLoadError error={people.error} code={people.errorCode} resource="people" endpoint={people.errorEndpoint} requestId={people.requestId} onRetry={people.reload} />
      )}
      {people.data && (
        <Section title="People" freshness={{ at: people.lastFetchedAt, isValidating: people.isValidating }}>
          {rows.length === 0 ? (
            <p className="text-xs text-fg-faint">No people in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-edge-subtle">
                    <DataTableHead>Person</DataTableHead>
                    <DataTableHead>Last event</DataTableHead>
                    <DataTableHead align="right">Events</DataTableHead>
                    <DataTableHead align="right">First seen</DataTableHead>
                    <DataTableHead align="right">Last seen</DataTableHead>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const label = p.display_name ?? p.external_user_id ?? p.end_user_id ?? 'anonymous'
                    return (
                      <tr key={`${p.end_user_id ?? 'anon'}:${p.first_seen_at}:${label}`} className="border-b border-edge-subtle/60">
                        <DataTableCell>
                          <span className="flex items-center gap-2">
                            <span className="truncate font-mono text-fg" title={label}>
                              {label}
                            </span>
                            {p.external_user_id ? <Badge tone="okSubtle">identified</Badge> : <Badge tone="neutral">anon</Badge>}
                          </span>
                        </DataTableCell>
                        <DataTableCell>
                          <span className="font-mono text-fg-muted">{p.last_event ?? '—'}</span>
                        </DataTableCell>
                        <DataTableCell align="right">
                          <span className="tabular-nums">{fmt(p.event_count)}</span>
                        </DataTableCell>
                        <DataTableCell align="right">
                          <RelativeTime value={p.first_seen_at} className="text-fg-muted" />
                        </DataTableCell>
                        <DataTableCell align="right">
                          <RelativeTime value={p.last_seen_at} className="text-fg-muted" />
                        </DataTableCell>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {people.data.next_before && (
            <div className="mt-3">
              <Btn size="sm" variant="ghost" onClick={() => setBefore(people.data!.next_before)} loading={people.isValidating}>
                Load more
              </Btn>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ─── Retention ───────────────────────────────────────────────────────────────

function RetentionTab({ availableEvents }: { availableEvents: string[] }) {
  const [returnEvent, setReturnEvent] = useState<string>('')
  const path = `/v1/admin/events/retention?weeks=${RETENTION_WEEKS}${returnEvent ? `&return_event=${encodeURIComponent(returnEvent)}` : ''}`
  const retention = usePageData<RetentionResult>(path)
  const weekCount = Math.max(0, ...(retention.data?.cohorts ?? []).map((c) => c.weeks.length))

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SelectField
          label="Counts as “came back”"
          id="retention-return-event"
          value={returnEvent}
          onChange={(e) => setReturnEvent(e.target.value)}
        >
          <option value="">Any event</option>
          {availableEvents.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </SelectField>
      </Card>
      {retention.loading && !retention.data && (
        <div className="flex items-center justify-center py-10 text-fg-faint text-sm">Building cohorts…</div>
      )}
      {retention.error && (
        <PageLoadError error={retention.error} code={retention.errorCode} resource="retention" endpoint={retention.errorEndpoint} requestId={retention.requestId} onRetry={retention.reload} />
      )}
      {retention.data && (
        <Section title={`Weekly retention — ${RETENTION_WEEKS} cohorts`} freshness={{ at: retention.lastFetchedAt, isValidating: retention.isValidating }}>
          {retention.data.cohorts.length === 0 ? (
            <p className="text-xs text-fg-faint">No cohorts yet — people appear here the week after they are first seen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-edge-subtle">
                    <DataTableHead>Cohort</DataTableHead>
                    <DataTableHead align="right">People</DataTableHead>
                    {Array.from({ length: weekCount }, (_, i) => (
                      <DataTableHead key={i} align="center">
                        W{i}
                      </DataTableHead>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {retention.data.cohorts.map((c) => (
                    <tr key={c.week_start} className="border-b border-edge-subtle/60">
                      <DataTableCell>
                        <span className="font-mono text-fg">{c.week_start}</span>
                      </DataTableCell>
                      <DataTableCell align="right">
                        <span className="tabular-nums text-fg-muted">{fmt(c.size)}</span>
                      </DataTableCell>
                      {Array.from({ length: weekCount }, (_, i) => {
                        const pct = c.weeks[i]
                        return (
                          <DataTableCell key={i} align="center" className="p-1">
                            <RetentionCell pct={pct} />
                          </DataTableCell>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

/** Cell shading = brand fill at the retention percentage; text stays AA. */
function RetentionCell({ pct }: { pct: number | undefined }) {
  if (pct == null) return <span className="block h-7 rounded-sm bg-surface-overlay/40" aria-label="not yet" />
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <span className="relative block h-7 min-w-11 overflow-hidden rounded-sm bg-surface-overlay/40">
      <span aria-hidden="true" className="absolute inset-0 bg-brand" style={{ opacity: 0.08 + (clamped / 100) * 0.72 }} />
      <span className="relative flex h-full items-center justify-center tabular-nums text-fg">{clamped.toFixed(0)}%</span>
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function identifiedPct(data: EventsSummary): string {
  const total = data.identified + data.anonymous
  if (total === 0) return 'no people yet'
  return `${Math.round((data.identified / total) * 100)}% identified`
}
