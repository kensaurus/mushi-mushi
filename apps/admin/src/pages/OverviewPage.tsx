/**
 * FILE: apps/admin/src/pages/OverviewPage.tsx
 * PURPOSE: Org-scoped portfolio dashboard — all connected projects at a glance.
 *          Shows per-project 7-day sessions, users, open tickets, and a DAU
 *          sparkline, with deep-links into each project's Activity + Reports.
 *
 * Data: GET /v1/admin/portfolio → org_portfolio_summary RPC.
 * Auth: jwtAuth + X-Mushi-Org-Id header (set by apiFetch via activeOrg).
 * Nav: navRegistry 'nav:overview', sectionId 'start'.
 *
 * Must keep working: portfolio fetch, project switch via footer links,
 * loading / error / empty states, critical/warn/ok health tones.
 */

import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { setActiveProjectIdSnapshot } from '../lib/activeProject'
import { Badge, Btn, Card, FreshnessPill, StatCard, StatGrid, type BadgeTone } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { BarSparkline } from '../components/charts'
import { relTime } from '../components/dashboard/types'
import { IconGauge } from '../components/icons'
import { SpringChromeEnter } from '../components/motion/SpringChromeEnter'
import { useAdminMode } from '../lib/mode'

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

type HealthTone = 'critical' | 'warn' | 'ok'

function healthToneFor(card: ProjectCard): HealthTone {
  if (card.critical_reports > 0) return 'critical'
  if (card.open_reports > 5) return 'warn'
  return 'ok'
}

const HEALTH_RANK: Record<HealthTone, number> = { critical: 0, warn: 1, ok: 2 }

const HEALTH_BADGE_TONE: Record<HealthTone, BadgeTone> = {
  critical: 'dangerSubtle',
  warn: 'warnSubtle',
  ok: 'okSubtle',
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function OverviewPage() {
  const copy = usePageCopy('/overview')

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
  } = usePageData<ProjectCard[]>('/v1/admin/portfolio')

  const portfolioTotals = data && data.length > 0 ? summarizePortfolio(data) : null

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-overview">
      <PageHeaderBar
        title={copy?.title ?? 'Overview'}
        description={
          copy?.description ??
          'All connected projects — 7-day activity and open tickets at a glance.'
        }
        icon={<IconGauge />}
        helpTitle={copy?.help?.title ?? 'About Overview'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Org-scoped portfolio view of every connected project — 7-day sessions, users, open tickets, and DAU sparklines with deep-links into each project.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Compare activity and open tickets across all projects in one view',
            'Spot projects with critical reports before switching context',
            'Jump into Activity or Reports for a project with one click',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Each card shows 7-day sessions and users plus a DAU sparkline. Footer links switch the active project and open Activity, Reports, or Dashboard.'
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
            show: Boolean(portfolioTotals),
            children: portfolioTotals ? (
              <StatGrid>
                <StatCard label="Projects" value={fmt(portfolioTotals.projectCount)} />
                <StatCard label="Sessions (7d)" value={fmt(portfolioTotals.totalSessions)} />
                <StatCard label="Users (7d)" value={fmt(portfolioTotals.totalUsers)} />
                <StatCard label="Open tickets" value={fmt(portfolioTotals.totalOpen)} />
                {portfolioTotals.totalCritical > 0 && (
                  <StatCard
                    label="Critical"
                    value={fmt(portfolioTotals.totalCritical)}
                    accent="text-danger"
                  />
                )}
              </StatGrid>
            ) : null,
          },
        ]}
      />

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-fg-faint text-sm">Loading portfolio…</div>
      )}
      {error && (
        <PageLoadError
          error={error}
          code={errorCode}
          resource="portfolio"
          endpoint={errorEndpoint}
          requestId={requestId}
          onRetry={reload}
        />
      )}
      {data && data.length === 0 && (
        <Card className="px-4 py-8 text-center text-sm text-fg-faint">
          <p className="font-medium text-fg-muted">No projects connected yet</p>
          <p className="mt-1 text-xs">
            <Link to="/connect" className="text-brand hover:underline">Connect your first project →</Link>
          </p>
        </Card>
      )}
      {data && data.length > 0 && (
        <PanelErrorBoundary label="Portfolio">
          <PortfolioGrid cards={data} />
        </PanelErrorBoundary>
      )}
    </div>
  )
}

// ─── Portfolio grid ───────────────────────────────────────────────────────────

function PortfolioGrid({ cards }: { cards: ProjectCard[] }) {
  const { isAdvanced } = useAdminMode()

  const sorted = useMemo(
    () =>
      [...cards].sort((a, b) => {
        const rank = HEALTH_RANK[healthToneFor(a)] - HEALTH_RANK[healthToneFor(b)]
        if (rank !== 0) return rank
        return (b.open_reports ?? 0) - (a.open_reports ?? 0)
      }),
    [cards],
  )

  const attention = sorted.filter((c) => healthToneFor(c) !== 'ok')
  const healthy = sorted.filter((c) => healthToneFor(c) === 'ok')
  const showGroups = isAdvanced && attention.length > 0 && healthy.length > 0

  if (!showGroups) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((card, i) => (
          <SpringChromeEnter key={card.project_id} delay={i * 0.03}>
            <ProjectHealthCard card={card} />
          </SpringChromeEnter>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="overview-needs-attention">
        <h3
          id="overview-needs-attention"
          className="mb-3 text-2xs font-medium uppercase tracking-wider text-fg-faint"
        >
          Needs attention ({attention.length})
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attention.map((card, i) => (
            <SpringChromeEnter key={card.project_id} delay={i * 0.03}>
              <ProjectHealthCard card={card} />
            </SpringChromeEnter>
          ))}
        </div>
      </section>
      <section aria-labelledby="overview-healthy">
        <h3
          id="overview-healthy"
          className="mb-3 text-2xs font-medium uppercase tracking-wider text-fg-faint"
        >
          Healthy ({healthy.length})
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {healthy.map((card, i) => (
            <SpringChromeEnter key={card.project_id} delay={(attention.length + i) * 0.03}>
              <ProjectHealthCard card={card} />
            </SpringChromeEnter>
          ))}
        </div>
      </section>
    </div>
  )
}

// ─── Project health card ──────────────────────────────────────────────────────

function ProjectHealthCard({ card }: { card: ProjectCard }) {
  const dauValues = (card.dau_spark ?? []).map((p) => p.dau)
  const healthTone = healthToneFor(card)

  const handleSwitchProject = () => {
    setActiveProjectIdSnapshot(card.project_id)
  }

  const borderTone =
    healthTone === 'critical'
      ? 'border-danger/40'
      : healthTone === 'warn'
        ? 'border-warn/40'
        : ''

  return (
    <Card
      className={`group relative flex flex-col overflow-hidden transition-shadow hover:shadow-sm ${borderTone}`}
    >
      {/* Header — title is the stretched primary target (WCAG 2.5.8) */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">
            <Link
              to="/dashboard"
              onClick={handleSwitchProject}
              className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm"
            >
              {card.label}
            </Link>
          </h3>
          {card.slug && (
            <p className="mt-0.5 truncate font-mono text-2xs text-fg-faint">{card.slug}</p>
          )}
        </div>
        <Badge tone={HEALTH_BADGE_TONE[healthTone]} className="relative z-10 shrink-0">
          {healthTone === 'critical'
            ? `${card.critical_reports} critical`
            : healthTone === 'warn'
              ? `${card.open_reports} open`
              : 'Healthy'}
        </Badge>
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

      {/* Footer links — z-10 so they sit above the stretched title link */}
      <div className="relative z-10 flex gap-2 border-t border-edge px-4 py-2">
        <Link
          to="/activity"
          onClick={handleSwitchProject}
          className="inline-flex min-h-6 items-center text-2xs text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
        >
          Activity →
        </Link>
        <Link
          to="/reports"
          onClick={handleSwitchProject}
          className="inline-flex min-h-6 items-center text-2xs text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
        >
          {card.open_reports > 0 ? `${card.open_reports} open` : 'Reports'}
        </Link>
        <Link
          to="/dashboard"
          onClick={handleSwitchProject}
          className="inline-flex min-h-6 items-center text-2xs text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
        >
          Dashboard
        </Link>
      </div>
    </Card>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function summarizePortfolio(cards: ProjectCard[]) {
  return {
    projectCount: cards.length,
    totalSessions: cards.reduce((s, c) => s + c.sessions_7d, 0),
    totalUsers: cards.reduce((s, c) => s + c.users_7d, 0),
    totalOpen: cards.reduce((s, c) => s + c.open_reports, 0),
    totalCritical: cards.reduce((s, c) => s + c.critical_reports, 0),
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
