/**
 * FILE: apps/admin/src/pages/OverviewPage.tsx
 * PURPOSE: Org-scoped portfolio dashboard — all connected projects at a glance.
 *          Shows per-project 7-day sessions, users, open tickets, and a DAU
 *          sparkline, with deep-links into each project's Activity + Reports.
 *
 * Data: GET /v1/admin/portfolio → org_portfolio_summary RPC.
 * Auth: jwtAuth + x-org-id header (set by apiFetch via activeOrg).
 * Nav: navRegistry 'nav:overview', sectionId 'start'.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { setActiveProjectIdSnapshot } from '../lib/activeProject'
import { PageHeader } from '../components/ui'
import { BarSparkline } from '../components/charts'
import { relTime } from '../components/dashboard/types'
import { CHIP_TONE } from '../lib/chipTone'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DauPoint {
  day: string
  dau: number
}

interface ProjectCard {
  project_id: string
  name: string
  label: string
  slug: string | null
  sessions_7d: number
  users_7d: number
  open_reports: number
  critical_reports: number
  last_report_at: string | null
  dau_spark: DauPoint[]
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function OverviewPage() {
  const { data, loading, error, reload } = usePageData<ProjectCard[]>('/v1/admin/portfolio')

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Overview"
        description="All connected projects — 7-day activity and open tickets at a glance."
      >
        <button
          onClick={reload}
          className="rounded border border-edge bg-surface-overlay px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-raised transition-colors"
        >
          Refresh
        </button>
      </PageHeader>

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-fg-faint text-sm">Loading portfolio…</div>
      )}
      {error && (
        <div className={`rounded px-4 py-3 text-sm ${CHIP_TONE.dangerSubtle}`}>
          Failed to load portfolio.{' '}
          <button onClick={reload} className="underline">Retry</button>
        </div>
      )}
      {data && data.length === 0 && (
        <div className="rounded border border-edge bg-surface-overlay px-4 py-8 text-center text-sm text-fg-faint">
          <p className="font-medium text-fg-muted">No projects connected yet</p>
          <p className="mt-1 text-xs">
            <Link to="/connect" className="text-brand hover:underline">Connect your first project →</Link>
          </p>
        </div>
      )}
      {data && data.length > 0 && <PortfolioGrid cards={data} />}
    </div>
  )
}

// ─── Portfolio grid ───────────────────────────────────────────────────────────

function PortfolioGrid({ cards }: { cards: ProjectCard[] }) {
  const totalSessions = cards.reduce((s, c) => s + c.sessions_7d, 0)
  const totalUsers = cards.reduce((s, c) => s + c.users_7d, 0)
  const totalOpen = cards.reduce((s, c) => s + c.open_reports, 0)
  const totalCritical = cards.reduce((s, c) => s + c.critical_reports, 0)

  return (
    <div className="space-y-6">
      {/* Portfolio totals header */}
      <div className="flex flex-wrap gap-6 rounded border border-edge bg-surface-overlay px-5 py-3">
        <PortfolioStat label="Projects" value={cards.length} />
        <PortfolioStat label="Sessions (7d)" value={totalSessions} />
        <PortfolioStat label="Users (7d)" value={totalUsers} />
        <PortfolioStat label="Open tickets" value={totalOpen} />
        {totalCritical > 0 && (
          <PortfolioStat label="Critical" value={totalCritical} tone="danger" />
        )}
      </div>

      {/* Per-project cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <ProjectHealthCard key={card.project_id} card={card} />
        ))}
      </div>
    </div>
  )
}

// ─── Project health card ──────────────────────────────────────────────────────

function ProjectHealthCard({ card }: { card: ProjectCard }) {
  const dauValues = (card.dau_spark ?? []).map((p) => p.dau)
  const healthTone = card.critical_reports > 0 ? 'critical' : card.open_reports > 5 ? 'warn' : 'ok'

  const handleSwitchProject = () => {
    setActiveProjectIdSnapshot(card.project_id)
  }

  return (
    <div
      className={`relative flex flex-col rounded border bg-surface-overlay transition-shadow hover:shadow-sm ${
        healthTone === 'critical'
          ? 'border-danger/40'
          : healthTone === 'warn'
          ? 'border-warn/40'
          : 'border-edge'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{card.label}</h3>
          {card.slug && (
            <p className="mt-0.5 truncate font-mono text-2xs text-fg-faint">{card.slug}</p>
          )}
        </div>
        <HealthChip tone={healthTone} openReports={card.open_reports} critical={card.critical_reports} />
      </div>

      {/* Sparkline */}
      {dauValues.length > 0 ? (
        <div className="mt-3 px-4">
          <BarSparkline values={dauValues} height={32} />
        </div>
      ) : (
        <div className="mt-3 flex h-8 items-center px-4">
          <span className="text-2xs text-fg-faint">No sessions this week</span>
        </div>
      )}

      {/* Stats row */}
      <div className="mt-3 flex gap-4 border-t border-edge px-4 py-3 text-xs text-fg-muted">
        <span title="Sessions this week">
          <span className="font-medium text-fg">{fmt(card.sessions_7d)}</span> sessions
        </span>
        <span title="Unique users this week">
          <span className="font-medium text-fg">{fmt(card.users_7d)}</span> users
        </span>
        {card.last_report_at && (
          <span className="ml-auto text-fg-faint" title={card.last_report_at}>
            {relTime(card.last_report_at)}
          </span>
        )}
      </div>

      {/* Footer links */}
      <div className="flex gap-2 border-t border-edge px-4 py-2">
        <Link
          to="/activity"
          onClick={handleSwitchProject}
          className="text-2xs text-brand hover:underline"
        >
          Activity →
        </Link>
        <Link
          to="/reports"
          onClick={handleSwitchProject}
          className="text-2xs text-fg-muted hover:text-fg hover:underline"
        >
          {card.open_reports > 0 ? `${card.open_reports} open` : 'Reports'}
        </Link>
        <Link
          to="/dashboard"
          onClick={handleSwitchProject}
          className="text-2xs text-fg-muted hover:text-fg hover:underline"
        >
          Dashboard
        </Link>
      </div>
    </div>
  )
}

// ─── Small components ─────────────────────────────────────────────────────────

function HealthChip({
  tone,
  openReports,
  critical,
}: {
  tone: 'critical' | 'warn' | 'ok'
  openReports: number
  critical: number
}) {
  const label =
    tone === 'critical' ? `${critical} critical` : tone === 'warn' ? `${openReports} open` : 'Healthy'
  const cls =
    tone === 'critical'
      ? 'border-danger/30 bg-danger-muted/30 text-danger'
      : tone === 'warn'
      ? 'border-warn/30 bg-warn-muted/30 text-warn'
      : 'border-ok/30 bg-ok-muted/30 text-ok'
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs font-medium ${cls}`}>{label}</span>
  )
}

function PortfolioStat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="flex flex-col">
      <span
        className={`text-xl font-semibold tabular-nums leading-none ${tone === 'danger' ? 'text-danger' : 'text-fg'}`}
      >
        {fmt(value)}
      </span>
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
