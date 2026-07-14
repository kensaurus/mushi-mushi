/**
 * FILE: apps/admin/src/pages/ActivityPage.tsx
 * PURPOSE: Per-project activity dashboard — sessions, page views, DAU trend,
 *          user split (identified vs. anonymous), top routes.
 *
 * Data: GET /v1/admin/activity?window=30 → project_activity_summary RPC.
 * Auth: jwtAuth (active project from x-project-id header via apiFetch).
 * Nav: navRegistry 'nav:activity', sectionId 'check'.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { PageHeader, StatGrid } from '../components/ui'
import { LineSparkline } from '../components/charts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DauPoint {
  day: string
  dau: number
}

interface TopRoute {
  route: string
  views: number
}

interface ActivityData {
  window_days: number
  sessions: number
  completed_sessions: number
  unique_devices: number
  identified_users: number
  avg_page_views: number
  avg_session_minutes: number
  dau_series: DauPoint[]
  top_routes: TopRoute[]
  reports: {
    total: number
    open: number
    critical: number
    high: number
  }
  user_split: {
    identified: number
    anonymous: number
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ActivityPage() {
  const { data, loading, error, reload } = usePageData<ActivityData>('/v1/admin/activity?window=30')

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Activity"
        description="End-user sessions and engagement for this project over the last 30 days."
      >
        <button
          onClick={reload}
          className="rounded border border-edge bg-surface-overlay px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-raised transition-colors"
        >
          Refresh
        </button>
      </PageHeader>

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-fg-faint text-sm">Loading activity…</div>
      )}
      {error && (
        <div className="rounded border border-danger/30 bg-danger-muted/20 px-4 py-3 text-sm text-danger">
          Failed to load activity data.{' '}
          <button onClick={reload} className="underline">Retry</button>
        </div>
      )}
      {data && <ActivityDashboard data={data} />}
    </div>
  )
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function ActivityDashboard({ data }: { data: ActivityData }) {
  const dauValues = (data.dau_series ?? []).map((p) => p.dau)

  const identifiedPct =
    data.user_split.identified + data.user_split.anonymous > 0
      ? Math.round(
          (data.user_split.identified /
            (data.user_split.identified + data.user_split.anonymous)) *
            100,
        )
      : 0

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <StatGrid>
        <MetricTile label="Sessions" value={fmt(data.sessions)} hint={`${fmt(data.completed_sessions)} completed`} />
        <MetricTile label="Unique devices" value={fmt(data.unique_devices)} hint={`${fmt(data.identified_users)} identified`} />
        <MetricTile label="Avg page views" value={String(data.avg_page_views ?? 0)} hint="per session" />
        <MetricTile
          label="Avg session"
          value={data.avg_session_minutes ? `${data.avg_session_minutes}m` : '—'}
          hint="minutes"
        />
      </StatGrid>

      {/* DAU Sparkline */}
      {dauValues.length > 0 && (
        <section className="rounded border border-edge bg-surface-overlay p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">
            Daily Active Users — last {data.window_days}d
          </h2>
          <LineSparkline values={dauValues} height={64} />
          <div className="mt-2 flex gap-4 text-xs text-fg-muted">
            <span>Peak: {Math.max(...dauValues)}</span>
            <span>Avg: {Math.round(dauValues.reduce((a, b) => a + b, 0) / dauValues.length)}</span>
          </div>
        </section>
      )}

      {/* User split + Reports at-a-glance */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded border border-edge bg-surface-overlay p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">User identity split</h2>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
              <div
                className="h-full rounded-full bg-brand motion-safe:transition-[width]"
                style={{ width: `${identifiedPct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-fg-muted">{identifiedPct}% identified</span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-fg-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-brand" />
              Identified: {fmt(data.user_split.identified)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-edge" />
              Anonymous: {fmt(data.user_split.anonymous)}
            </span>
          </div>
        </section>

        <section className="rounded border border-edge bg-surface-overlay p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">Reports this period</h2>
          <div className="flex gap-4">
            <CountPill label="Open" value={data.reports.open} />
            <CountPill label="Critical" value={data.reports.critical} tone="danger" />
            <CountPill label="High" value={data.reports.high} tone="warn" />
          </div>
          <Link to="/reports" className="mt-3 block text-xs text-brand hover:underline">
            View all reports →
          </Link>
        </section>
      </div>

      {/* Top routes */}
      {data.top_routes.length > 0 && (
        <section className="rounded border border-edge bg-surface-overlay p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">Top pages by views</h2>
          <ol className="space-y-1.5">
            {data.top_routes.map((r, i) => {
              const maxViews = data.top_routes[0].views
              const pct = Math.round((r.views / maxViews) * 100)
              return (
                <li key={r.route} className="flex items-center gap-3 text-xs">
                  <span className="w-4 shrink-0 text-right text-fg-faint">{i + 1}</span>
                  <span className="w-40 shrink-0 truncate font-mono text-fg-muted" title={r.route}>
                    {r.route}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
                    <div className="h-full rounded-full bg-brand/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">{fmt(r.views)}</span>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {data.sessions === 0 && (
        <div className="rounded border border-edge bg-surface-overlay px-4 py-8 text-center text-sm text-fg-faint">
          <p className="font-medium text-fg-muted">No sessions recorded yet</p>
          <p className="mt-1 text-xs">
            Once users visit pages with the Mushi SDK installed, sessions will appear here.{' '}
            <Link to="/connect" className="text-brand hover:underline">
              Check your SDK setup →
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Small components ─────────────────────────────────────────────────────────

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-edge bg-surface-overlay px-4 py-3">
      <span className="text-2xs font-medium uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="text-2xl font-semibold tabular-nums leading-none text-fg">{value}</span>
      {hint && <span className="text-xs text-fg-faint">{hint}</span>}
    </div>
  )
}

function CountPill({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'warn' }) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg'
  return (
    <div className="flex flex-col items-center">
      <span className={`text-2xl font-semibold tabular-nums leading-none ${toneClass}`}>{value}</span>
      <span className="mt-0.5 text-2xs text-fg-faint">{label}</span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
