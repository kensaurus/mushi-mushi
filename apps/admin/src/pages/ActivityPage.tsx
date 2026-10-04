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
import { usePageCopy } from '../lib/copy'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Btn, Card, FreshnessPill, Section, StatCard, StatGrid } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { LineSparkline } from '../components/charts'
import { IconHealth } from '../components/icons'
import { identitySplit, type UserSplitPayload } from '../lib/activityIdentitySplit'

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
  user_split: UserSplitPayload
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ActivityPage() {
  const copy = usePageCopy('/activity')
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const {
    data,
    loading,
    error,
    errorCode,
    requestId,
    errorEndpoint,
    isValidating,
    lastFetchedAt,
    reload,
  } = usePageData<ActivityData>('/v1/admin/activity?window=30')

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-activity">
      <PageHeaderBar
        title={copy?.title ?? 'Activity'}
        description={
          copy?.description ??
          'End-user sessions and engagement for this project over the last 30 days.'
        }
        projectScope={projectName ?? undefined}
        icon={<IconHealth />}
        helpTitle={copy?.help?.title ?? 'About Activity'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Per-project activity from SDK telemetry — sessions, page views, identified vs. anonymous users, and top routes over the last 30 days.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'See whether users are completing sessions or bouncing early',
            'Compare identified vs. anonymous traffic before tuning rewards',
            'Spot which routes drive the most page views',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Sessions appear once the Mushi SDK is installed and users visit instrumented pages. Use Connect if the empty state persists.'
        }
      >
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
        <Btn size="sm" variant="ghost" onClick={reload} loading={isValidating}>
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: Boolean(data),
            children: data ? (
              <StatGrid>
                <StatCard
                  label="Sessions"
                  value={fmt(data.sessions)}
                  detail={`${fmt(data.completed_sessions)} completed`}
                />
                <StatCard
                  label="Unique devices"
                  value={fmt(data.unique_devices)}
                  detail={`${fmt(data.identified_users)} identified`}
                />
                <StatCard
                  label="Avg page views"
                  value={String(data.avg_page_views ?? 0)}
                  detail="per session"
                />
                <StatCard
                  label="Avg session"
                  value={data.avg_session_minutes ? `${data.avg_session_minutes}m` : '—'}
                  detail="minutes"
                />
              </StatGrid>
            ) : null,
          },
        ]}
      />

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-fg-faint text-sm">Loading activity…</div>
      )}
      {error && (
        <PageLoadError
          error={error}
          code={errorCode}
          resource="activity"
          endpoint={errorEndpoint}
          requestId={requestId}
          onRetry={reload}
        />
      )}
      {data && <ActivityDashboard data={data} />}
    </div>
  )
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function ActivityDashboard({ data }: { data: ActivityData }) {
  const dauValues = (data.dau_series ?? []).map((p) => p.dau)

  const split = identitySplit(data.user_split)
  const identifiedPct = split.identifiedPct ?? 0

  return (
    <div className="space-y-4">
      {/* DAU Sparkline */}
      {dauValues.length > 0 && (
        <Section title={`Daily Active Users — last ${data.window_days}d`}>
          <LineSparkline values={dauValues} height={64} />
          <div className="mt-2 flex gap-4 text-xs text-fg-muted">
            <span>Peak: {Math.max(...dauValues)}</span>
            <span>Avg: {Math.round(dauValues.reduce((a, b) => a + b, 0) / dauValues.length)}</span>
          </div>
        </Section>
      )}

      {/* User split + Reports at-a-glance */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title={split.unit === 'people' ? 'Who uses the app' : 'Sessions by sign-in'}>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
              <div
                className="h-full rounded-full bg-brand motion-safe:transition-[width]"
                style={{ width: `${identifiedPct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-fg-muted">
              {split.identifiedPct == null ? 'No visits yet' : `${identifiedPct}% signed in`}
            </span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-fg-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-brand" />
              {split.identifiedLabel}: {fmt(split.identified)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-edge" />
              {split.anonymousLabel}: {fmt(split.anonymous)}
            </span>
          </div>
        </Section>

        {/* Open reports of any age, each pill opening the list it counts (QA 175, QA 289). */}
        <Section title="Open reports">
          <div className="flex gap-4">
            <CountPill label="Open" value={data.reports.open} to="/reports?status=open" />
            <CountPill label="Critical" value={data.reports.critical} tone="danger" to="/reports?status=open&severity=critical" />
            <CountPill label="High" value={data.reports.high} tone="warn" to="/reports?status=open&severity=high" />
          </div>
          <Link to="/reports" className="mt-3 block text-xs text-brand hover:underline">
            View all reports →
          </Link>
        </Section>
      </div>

      {/* Top routes */}
      {data.top_routes.length > 0 && (
        <Section title="Top pages by views">
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
        </Section>
      )}

      {data.sessions === 0 && (
        <Card className="px-4 py-8 text-center text-sm text-fg-faint">
          <p className="font-medium text-fg-muted">No sessions recorded yet</p>
          <p className="mt-1 text-xs">
            Once users visit pages with the Mushi SDK installed, sessions will appear here.{' '}
            <Link to="/connect" className="text-brand hover:underline">
              Check your SDK setup →
            </Link>
          </p>
        </Card>
      )}
    </div>
  )
}

// ─── Small components ─────────────────────────────────────────────────────────

function CountPill({
  label,
  value,
  tone,
  to,
}: {
  label: string
  value: number
  tone?: 'danger' | 'warn'
  to: string
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg'
  return (
    <Link
      to={to}
      className="flex flex-col items-center rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <span className={`text-2xl font-semibold tabular-nums leading-none ${toneClass}`}>{value}</span>
      <span className="mt-0.5 text-2xs text-fg-faint">{label}</span>
    </Link>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
