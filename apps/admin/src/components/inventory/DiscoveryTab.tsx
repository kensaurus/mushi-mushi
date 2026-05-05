import { useMemo, useState } from 'react'
import { Btn, Card, Badge, ErrorAlert } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'
import { useRealtimeReload } from '../../lib/realtime'
import { DiscoveryLifecycle, type LifecycleStep } from './DiscoveryLifecycle'
import { DiscoveryMetrics, type DiscoveryMetric } from './DiscoveryMetrics'
import { ObservedRouteCard, type ObservedRoute } from './ObservedRouteCard'
import { ProposalReviewModal } from './ProposalReviewModal'

/**
 * Mushi v2.1 Discovery tab — the home for "what has the SDK actually
 * seen on this app, and can we ask Claude to draft an inventory.yaml
 * from it?"
 *
 * Layout (top to bottom):
 *
 *   1. **Lifecycle stepper** — 4 steps (Install → Observe → Propose →
 *      Accept) with done/active/pending states. Tells the user where
 *      they are in the loop without forcing them to read.
 *
 *   2. **Hero metric tiles** — events / routes / users / freshness,
 *      each in its own colour for category-squint distinction.
 *
 *   3. **Action card** — the prominent CTA. When ready, this is the
 *      "Generate" button + a sentence explaining what Claude will
 *      do. When not ready, an explanation of what's missing + an SDK
 *      install snippet.
 *
 *   4. **Proposals** — recent drafts as compact cards, each with the
 *      story/page count summary so the user knows whether to open it.
 *
 *   5. **Observed routes** — rich route cards (event-count bar,
 *      testid/API chips, expand for detail) sorted by observation
 *      count.
 */

interface DiscoveryRouteRow {
  route: string
  latest_title: string | null
  latest_dom_summary: string | null
  observation_count: number
  observed_testids: string[]
  observed_apis: string[]
  distinct_users: number
  last_seen_at: string
  first_seen_at: string
}

interface DiscoveryPayload {
  routes: DiscoveryRouteRow[]
  total_events: number
  ready_to_propose: boolean
}

interface ProposalSummary {
  id: string
  status: 'draft' | 'accepted' | 'discarded'
  llm_model: string
  observation_count: number
  inventory_id: string | null
  created_at: string
  decided_at: string | null
  decided_by: string | null
}

interface Props {
  projectId: string
  /** Called after a proposal is accepted so the parent can reload its inventory query. */
  onAccepted: () => void
}

export function DiscoveryTab({ projectId, onAccepted }: Props) {
  const toast = useToast()
  const discoveryPath = `/v1/admin/inventory/${projectId}/discovery`
  const proposalsPath = `/v1/admin/inventory/${projectId}/proposals`

  const discovery = usePageData<DiscoveryPayload>(discoveryPath, { deps: [projectId] })
  const proposals = usePageData<{ proposals: ProposalSummary[] }>(proposalsPath, { deps: [projectId] })

  const [generating, setGenerating] = useState(false)
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null)

  useRealtimeReload(['inventory_proposals', 'discovery_events'], () => {
    proposals.reload()
    discovery.reload()
  }, { debounceMs: 800, enabled: true })

  const generate = async () => {
    setGenerating(true)
    try {
      const res = await apiFetch<{ proposalId: string; routeCount: number; storyCount: number; validationOk: boolean }>(
        `/v1/admin/inventory/${projectId}/propose`,
        { method: 'POST', body: '{}' },
      )
      if (res.ok && res.data) {
        toast.success(
          'Draft generated',
          `Claude proposed ${res.data.storyCount} stories from ${res.data.routeCount} routes.`,
        )
        proposals.reload()
        setActiveProposalId(res.data.proposalId)
      } else {
        toast.push({
          tone: 'error',
          message: 'Could not generate draft',
          description: res.error?.message ?? 'unknown',
        })
      }
    } finally {
      setGenerating(false)
    }
  }

  const data = discovery.data
  const proposalRows = proposals.data?.proposals ?? []
  const draftRow = proposalRows.find((p) => p.status === 'draft')
  const acceptedCount = proposalRows.filter((p) => p.status === 'accepted').length
  const totalEvents = data?.total_events ?? 0
  const routes = data?.routes ?? []
  const hasAnyEvents = totalEvents > 0
  const ready = data?.ready_to_propose ?? false

  // ---------------- derived: lifecycle steps ----------------------
  const lifecycle: LifecycleStep[] = useMemo(() => {
    const lastSeen = routes[0]?.last_seen_at
    return [
      {
        id: 'install',
        state: hasAnyEvents ? 'done' : 'active',
        label: 'Install',
        value: hasAnyEvents ? 'SDK reaching us' : 'Add SDK',
        detail: hasAnyEvents
          ? lastSeen
            ? `last ping ${formatRelative(lastSeen)}`
            : undefined
          : '@mushi-mushi/web with discoverInventory',
        icon: <SdkIcon />,
      },
      {
        id: 'observe',
        state: hasAnyEvents ? (ready ? 'done' : 'active') : 'pending',
        label: 'Observe',
        value: `${routes.length} route${routes.length === 1 ? '' : 's'} · ${totalEvents} event${totalEvents === 1 ? '' : 's'}`,
        detail: hasAnyEvents
          ? ready
            ? 'enough data to draft'
            : `need ≥3 routes & ≥10 events`
          : 'waiting for first navigation',
        icon: <EyeIcon />,
      },
      {
        id: 'propose',
        state: draftRow
          ? 'done'
          : ready
            ? 'active'
            : 'pending',
        label: 'Propose',
        value: draftRow
          ? `draft from ${formatRelative(draftRow.created_at)}`
          : ready
            ? 'ready to draft'
            : '—',
        detail: draftRow
          ? `${draftRow.llm_model}`
          : ready
            ? 'Claude will draft inventory.yaml'
            : undefined,
        icon: <SparkleIcon />,
      },
      {
        id: 'accept',
        // A pending draft outranks "we accepted something a week ago" —
        // when you have an undecided draft, this step is the action.
        state: draftRow ? 'active' : acceptedCount > 0 ? 'done' : 'pending',
        label: 'Accept',
        value: draftRow
          ? 'review draft →'
          : acceptedCount > 0
            ? `${acceptedCount} accepted`
            : '—',
        detail: draftRow
          ? acceptedCount > 0
            ? `(${acceptedCount} previously accepted)`
            : 'becomes your active inventory'
          : acceptedCount > 0
            ? 'inventory active'
            : undefined,
        cta: draftRow
          ? {
              label: 'Open draft',
              onClick: () => setActiveProposalId(draftRow.id),
            }
          : undefined,
        icon: <CheckIcon />,
      },
    ]
  }, [hasAnyEvents, ready, routes, totalEvents, draftRow, acceptedCount])

  // ---------------- derived: hero metrics --------------------------
  // NOTE: this is the *sum* of per-route distinct users — a visitor who
  // browsed three routes is counted three times. The server-side view
  // doesn't expose a true site-wide distinct count, so we surface this
  // as "user-route reach" rather than the misleading "distinct users".
  const userRouteReach = useMemo(
    () => routes.reduce((s, r) => s + r.distinct_users, 0),
    [routes],
  )
  const lastSeenAt = routes[0]?.last_seen_at
  const metrics: DiscoveryMetric[] = [
    {
      id: 'events',
      label: 'Events / 30d',
      // Data tile — stays in `info` so brand is reserved for the
      // single page-level CTA (H4 brand-color budget).
      value: totalEvents,
      detail: hasAnyEvents
        ? `across ${routes.length} route${routes.length === 1 ? '' : 's'}`
        : 'awaiting first event',
      tone: hasAnyEvents ? 'info' : 'neutral',
      icon: <EventsIcon />,
    },
    {
      id: 'routes',
      label: 'Routes seen',
      value: routes.length,
      detail: ready ? 'enough variety' : 'need ≥3 to propose',
      tone: ready ? 'ok' : routes.length > 0 ? 'warn' : 'neutral',
      icon: <RouteIcon />,
    },
    {
      id: 'users',
      label: 'User-route reach',
      value: userRouteReach,
      detail:
        userRouteReach > 0
          ? 'sum of distinct users per route (overlaps counted)'
          : 'no real users yet',
      tone: userRouteReach > 0 ? 'info' : 'neutral',
      icon: <UsersIcon />,
    },
    {
      id: 'freshness',
      label: 'Last activity',
      value: lastSeenAt ? formatRelative(lastSeenAt) : '—',
      detail: lastSeenAt ? 'SDK is live' : 'SDK not reporting',
      tone: isStale(lastSeenAt) ? 'warn' : lastSeenAt ? 'ok' : 'neutral',
      icon: <ClockIcon />,
    },
  ]

  // ---------------- derived: observed route cards ------------------
  const observedRoutes: ObservedRoute[] = useMemo(
    () =>
      routes.map((r) => ({
        route: r.route,
        pageTitle: r.latest_title ?? r.latest_dom_summary,
        eventCount: r.observation_count,
        uniqueUsers: r.distinct_users,
        testids: r.observed_testids,
        apis: r.observed_apis,
      })),
    [routes],
  )
  const maxEventCount = useMemo(
    () => observedRoutes.reduce((max, r) => Math.max(max, r.eventCount), 0),
    [observedRoutes],
  )

  return (
    <div className="space-y-4" data-testid="mushi-discovery-tab">
      {/* (1) Lifecycle */}
      <Card className="p-4 space-y-3">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xs uppercase tracking-wider text-fg-faint">SDK Passive Discovery</p>
            <h2 className="text-base font-semibold text-fg">From SDK ping to active inventory</h2>
          </div>
          <Btn type="button" size="sm" variant="ghost" onClick={() => discovery.reload()}>
            Refresh
          </Btn>
        </header>
        <DiscoveryLifecycle steps={lifecycle} />
      </Card>

      {/* (2) Hero metrics */}
      <DiscoveryMetrics metrics={metrics} />

      {/* (3) Action / proposal area */}
      <ActionCard
        ready={ready}
        hasEvents={hasAnyEvents}
        generating={generating}
        onGenerate={generate}
        draftRow={draftRow}
        onOpenDraft={(id) => setActiveProposalId(id)}
        projectId={projectId}
        routeCount={routes.length}
        eventCount={totalEvents}
        testidCount={routes.reduce((s, r) => s + r.observed_testids.length, 0)}
      />

      {discovery.error && <ErrorAlert message={discovery.error} onRetry={discovery.reload} />}

      {/* (4) Past proposals (if any beyond the current draft) */}
      {proposalRows.length > 0 && (
        <ProposalsList
          proposals={proposalRows}
          onOpen={(id) => setActiveProposalId(id)}
          onRefresh={() => proposals.reload()}
        />
      )}

      {/* (5) Observed routes — rich cards */}
      <ObservedRoutesSection
        routes={observedRoutes}
        maxEventCount={maxEventCount}
        loading={discovery.loading && !data}
      />

      {activeProposalId && (
        <ProposalReviewModal
          projectId={projectId}
          proposalId={activeProposalId}
          onClose={() => setActiveProposalId(null)}
          onAccepted={() => {
            setActiveProposalId(null)
            proposals.reload()
            onAccepted()
          }}
          onDiscarded={() => {
            setActiveProposalId(null)
            proposals.reload()
          }}
        />
      )}
    </div>
  )
}

// ---------------- Action card ----------------------------------------

function ActionCard({
  ready,
  hasEvents,
  generating,
  onGenerate,
  draftRow,
  onOpenDraft,
  projectId,
  routeCount,
  eventCount,
  testidCount,
}: {
  ready: boolean
  hasEvents: boolean
  generating: boolean
  onGenerate: () => void
  draftRow?: ProposalSummary
  onOpenDraft: (id: string) => void
  projectId: string
  routeCount: number
  eventCount: number
  testidCount: number
}) {
  if (!hasEvents) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-info-muted/40 ring-1 ring-info/30 text-info flex items-center justify-center">
            <SdkIcon />
          </div>
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wider text-fg-faint">Step 1 — Install</p>
            <h3 className="text-sm font-semibold text-fg">Add the SDK so we can observe your app</h3>
            <p className="text-xs text-fg-muted mt-1">
              Install <code className="px-1 py-0.5 rounded bg-surface-overlay/60 font-mono text-2xs">@mushi-mushi/web</code> and
              flip on <code className="px-1 py-0.5 rounded bg-surface-overlay/60 font-mono text-2xs">discoverInventory: true</code>.
              Every navigation will post a tiny payload — route, page title, the data-testids in the DOM, outbound API calls,
              and a 200-char DOM summary. Once we have ≥3 routes & ≥10 events, Claude can draft your inventory.
            </p>
          </div>
        </div>
        <pre className="text-2xs font-mono p-3 rounded-md bg-surface-overlay/60 border border-edge-subtle overflow-auto whitespace-pre">{`import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: '${projectId}',
  apiKey: process.env.MUSHI_API_KEY!,
  capture: {
    discoverInventory: {
      enabled: true,
      // Optional: feed your framework's static route templates so
      // /practice/abc-123 normalizes to /practice/[id] cleanly.
      routeTemplates: ['/practice/[id]', '/lessons/[lessonId]'],
    },
  },
})`}</pre>
      </Card>
    )
  }

  if (!ready) {
    const needRoutes = Math.max(0, 3 - routeCount)
    const needEvents = Math.max(0, 10 - eventCount)
    return (
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-warn-muted/40 ring-1 ring-warn/30 text-warn flex items-center justify-center">
            <ClockIcon />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xs uppercase tracking-wider text-fg-faint">Step 2 — Observe</p>
            <h3 className="text-sm font-semibold text-fg">A bit more traffic and we can draft</h3>
            <p className="text-xs text-fg-muted mt-1">
              We've seen <span className="text-fg font-medium tabular-nums">{eventCount}</span> event
              {eventCount === 1 ? '' : 's'} across{' '}
              <span className="text-fg font-medium tabular-nums">{routeCount}</span> route
              {routeCount === 1 ? '' : 's'}. To make a useful proposal, Claude wants{' '}
              <strong>at least 3 routes and 10 events</strong> — keep clicking through your app, or have a teammate try it out.
            </p>
            <div className="flex flex-wrap gap-3 mt-2 text-2xs text-fg-faint">
              {needRoutes > 0 && <span>Need <span className="text-warn font-medium">{needRoutes} more route{needRoutes === 1 ? '' : 's'}</span></span>}
              {needEvents > 0 && <span>Need <span className="text-warn font-medium">{needEvents} more event{needEvents === 1 ? '' : 's'}</span></span>}
            </div>
          </div>
        </div>
      </Card>
    )
  }

  // Ready state — the prominent CTA. This is the only brand-tinted card on
  // the page, so the brand colour earns its primacy (H4 brand-color budget).
  return (
    <Card className="p-4 ring-1 ring-brand/25 bg-brand/[0.04]">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-brand/20 ring-1 ring-brand/40 text-brand flex items-center justify-center">
            <SparkleIcon />
          </div>
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wider text-brand">Step 3 — Propose</p>
            <h3 className="text-sm font-semibold text-fg">
              {draftRow ? 'You have a draft ready to review' : 'Ready to draft your inventory'}
            </h3>
            <p className="text-xs text-fg-muted mt-1">
              {draftRow ? (
                <>
                  Claude already drafted from {routeCount} route{routeCount === 1 ? '' : 's'} ·{' '}
                  {testidCount} testids · {eventCount} events. You can regenerate or open the existing draft.
                </>
              ) : (
                <>
                  Claude will analyse <span className="text-fg font-medium">{routeCount} route{routeCount === 1 ? '' : 's'}</span>,{' '}
                  <span className="text-fg font-medium">{testidCount} test ids</span>, and{' '}
                  <span className="text-fg font-medium">{eventCount} events</span> and propose user stories,
                  pages, and actions. You'll review the draft before anything is saved as your active inventory.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
          <Btn
            type="button"
            onClick={onGenerate}
            disabled={generating}
            data-testid="mushi-discovery-generate"
          >
            {generating ? 'Generating draft…' : draftRow ? 'Regenerate draft' : 'Generate draft inventory'}
          </Btn>
          {draftRow && (
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenDraft(draftRow.id)}
            >
              Open existing draft →
            </Btn>
          )}
        </div>
      </div>
    </Card>
  )
}

// ---------------- Proposals list -------------------------------------

function ProposalsList({
  proposals,
  onOpen,
  onRefresh,
}: {
  proposals: ProposalSummary[]
  onOpen: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xs uppercase tracking-wider text-fg-faint">All proposals</p>
          <h2 className="text-base font-semibold text-fg">Drafts &amp; accepted versions</h2>
        </div>
        <Btn type="button" size="sm" variant="ghost" onClick={onRefresh}>
          Refresh
        </Btn>
      </div>
      <ul className="space-y-1.5">
        {proposals.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 px-3 py-2 rounded-md border border-edge-subtle bg-surface-overlay/40 hover:bg-surface-overlay transition-colors"
          >
            <ProposalStatusPill status={p.status} />
            <div className="grow min-w-0">
              <p className="text-xs font-medium text-fg truncate">
                {p.llm_model}
                <span className="ml-2 text-fg-muted font-normal tabular-nums">
                  {p.observation_count} routes
                </span>
              </p>
              <p className="text-2xs text-fg-faint">
                {new Date(p.created_at).toLocaleString()}
                {p.decided_at && p.status !== 'draft' && (
                  <> · decided {formatRelative(p.decided_at)}</>
                )}
              </p>
            </div>
            <Btn
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpen(p.id)}
            >
              {p.status === 'draft' ? 'Review →' : 'View'}
            </Btn>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ProposalStatusPill({ status }: { status: 'draft' | 'accepted' | 'discarded' }) {
  const styles =
    status === 'accepted'
      ? 'bg-ok-muted text-ok border-ok/30'
      : status === 'discarded'
        ? 'bg-surface-overlay text-fg-muted border-edge-subtle'
        : 'bg-warn-muted text-warn border-warn/30'
  return (
    <Badge className={`${styles} border uppercase tracking-wider text-2xs`}>
      {status}
    </Badge>
  )
}

// ---------------- Observed routes section ----------------------------

function ObservedRoutesSection({
  routes,
  maxEventCount,
  loading,
}: {
  routes: ObservedRoute[]
  maxEventCount: number
  loading: boolean
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xs uppercase tracking-wider text-fg-faint">SDK observations</p>
          <h2 className="text-base font-semibold text-fg">Routes the SDK has seen</h2>
        </div>
        <span className="text-2xs text-fg-faint tabular-nums">
          {routes.length} {routes.length === 1 ? 'route' : 'routes'}
        </span>
      </div>
      {loading ? (
        <p className="text-xs text-fg-muted">Loading observed routes…</p>
      ) : routes.length === 0 ? (
        <div className="rounded-md border border-dashed border-edge-subtle p-4 text-center">
          <p className="text-xs text-fg-muted">
            No routes observed yet. Once your SDK is wired up with{' '}
            <code className="px-1 py-0.5 rounded bg-surface-overlay/60 font-mono text-2xs">discoverInventory: true</code>{' '}
            and someone navigates your app, this fills up automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[36rem] overflow-auto pr-1">
          {routes.map((r) => (
            <ObservedRouteCard key={r.route} route={r} maxEventCount={maxEventCount} />
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------- helpers --------------------------------------------

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 0) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d ago`
}

function isStale(iso?: string): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() > 1000 * 60 * 60 * 24
}

// ---------------- icons (currentColor, 14px) -------------------------

function SdkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 7h2M5 9.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11" cy="7.5" r="1" fill="currentColor" />
    </svg>
  )
}
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.75 8C3.5 4.5 5.5 3 8 3s4.5 1.5 6.25 5C12.5 11.5 10.5 13 8 13s-4.5-1.5-6.25-5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2L9 6L13 7L9 8L8 12L7 8L3 7L7 6L8 2Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 11L13 12.5L14.5 13L13 13.5L12.5 15L12 13.5L10.5 13L12 12.5L12.5 11Z"
        fill="currentColor"
      />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8.5L6 11.5L13 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function EventsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 13L5 9L8 11L11 6L14 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function RouteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.5" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M3.5 5.5V8a2 2 0 002 2h5a2 2 0 012 2v.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 13c0-2 2-3.5 4-3.5s4 1.5 4 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 13c0-1.5 1-2.5 2-2.5s2 1 2 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5V8L10 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
