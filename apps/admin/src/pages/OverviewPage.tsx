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
 * loading / error / empty states, health tones
 * (critical / not-connected / silent / warn / quiet / ok).
 *
 * Health tone reads `last_seen_at` (added to the RPC by migration
 * 20260816130000). Until that migration is applied the field is absent and the
 * page falls back to the report-count tones — see `healthToneFor`.
 */

import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { setActiveProjectIdSnapshot } from '../lib/activeProject'
import { Badge, Btn, Card, FreshnessPill, StatCard, StatGrid } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { BarSparkline } from '../components/charts'
import { relTime } from '../components/dashboard/types'
import { IconGauge } from '../components/icons'
import { HEARTBEAT_HINT } from '../lib/heartbeat'
import { HEALTH_BADGE_TONE, HEALTH_RANK, healthBadgeLabel, healthToneFor, isCalmTone, splitBySessions, type HealthTone } from '../lib/overviewView'
import { useAdminMode } from '../lib/mode'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { FirstDiagnosisInline } from '../components/onboarding/FirstDiagnosisScreen'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { RecipeStateChip } from '../components/recipe/RecipeStateChip'
import type { ElementState } from '../lib/recipeTypes'
import type { PortfolioResponse } from '../lib/portfolioTypes'

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
  /** Freshest SDK heartbeat across the project's live API keys.
   *
   *  Tri-state on purpose. `undefined` = the deployed `org_portfolio_summary`
   *  RPC predates the column (migration 20260816130000 not applied yet), so we
   *  know nothing and must not claim the project is disconnected. `null` = the
   *  RPC ran and reports no key has ever authenticated. */
  last_seen_at?: string | null
  dau_spark: DauPoint[]
}

const HEALTH_BADGE_HINT: Record<HealthTone, string | undefined> = {
  critical: undefined,
  'not-connected': HEARTBEAT_HINT.never,
  silent: HEARTBEAT_HINT.dead,
  warn: 'Open reports: waiting for triage or a decision (new, classified, grouped or reopened).',
  quiet: 'No user sessions in the last 7 days.',
  ok: undefined,
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

  // Only read when the portfolio is empty: decides between "send your
  // first test report here" (project exists) and "create a project".
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const emptyStateProject = data && data.length === 0 && !setup.loading ? setup.activeProject : null

  const portfolioTotals = data && data.length > 0 ? summarizePortfolio(data) : null

  // Recipe chip per card (Plan 019 §3): the worst recipe state, read from the
  // portfolio rollup. Loaded only once there are cards; a failure just hides
  // the chips — the activity cards never depend on it.
  const orgId = useActiveOrgId()
  const recipe = usePageData<PortfolioResponse>(orgId && data && data.length > 0 ? `/v1/admin/orgs/${orgId}/portfolio` : null)
  const worstByProject = useMemo(
    () => new Map((recipe.data?.cards ?? []).map((c) => [c.projectId, c.worst] as const)),
    [recipe.data],
  )

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
                <StatCard label="Open reports" value={fmt(portfolioTotals.totalOpen)} />
                {portfolioTotals.totalCritical > 0 && (
                  <StatCard
                    label="Open critical"
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
        // A project with no traffic yet gets the one-click first diagnosis
        // right here; a brand-new org with no project gets the wizard link.
        emptyStateProject ? (
          <FirstDiagnosisInline
            surface="overview"
            projectId={emptyStateProject.project_id}
            projectName={emptyStateProject.project_name}
            onDiagnosed={() => {
              setup.reload()
              reload()
            }}
          />
        ) : (
          <Card className="px-4 py-8 text-center text-sm text-fg-faint">
            <p className="font-medium text-fg-muted">No projects connected yet</p>
            <p className="mt-1 text-xs">
              <Link to="/onboarding" className="text-brand hover:underline">Create your first project →</Link>
            </p>
          </Card>
        )
      )}
      {data && data.length > 0 && (
        <PanelErrorBoundary label="Portfolio">
          <PortfolioGrid cards={data} recipeWorst={worstByProject} />
        </PanelErrorBoundary>
      )}
    </div>
  )
}

// ─── Portfolio grid ───────────────────────────────────────────────────────────

function PortfolioGrid({ cards, recipeWorst }: { cards: ProjectCard[]; recipeWorst: ReadonlyMap<string, ElementState> }) {
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

  const { active, idle } = splitBySessions(sorted)
  const attention = active.filter((c) => !isCalmTone(healthToneFor(c)))
  const healthy = active.filter((c) => isCalmTone(healthToneFor(c)))
  const showGroups = isAdvanced && attention.length > 0 && healthy.length > 0
  const idleList = idle.length > 0 ? <NoSessionsList cards={idle} recipeWorst={recipeWorst} /> : null

  // No per-card entrance stagger: the tenth card was still fading in when the
  // page settled and read as "dimmed" with no reason (round-2 sweep 2026-11-18).
  if (!showGroups) {
    return (
      <div className="flex flex-col gap-4">
        {active.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((card) => (
              <ProjectHealthCard key={card.project_id} card={card} recipeWorst={recipeWorst.get(card.project_id) ?? null} />
            ))}
          </div>
        )}
        {idleList}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="overview-needs-attention">
        <h3
          id="overview-needs-attention"
          className="mb-3 text-2xs font-semibold text-fg-secondary"
        >
          Needs attention ({attention.length})
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attention.map((card) => (
            <ProjectHealthCard key={card.project_id} card={card} recipeWorst={recipeWorst.get(card.project_id) ?? null} />
          ))}
        </div>
      </section>
      <section aria-labelledby="overview-healthy">
        <h3
          id="overview-healthy"
          className="mb-3 text-2xs font-semibold text-fg-secondary"
        >
          Nothing needed ({healthy.length})
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {healthy.map((card) => (
            <ProjectHealthCard key={card.project_id} card={card} recipeWorst={recipeWorst.get(card.project_id) ?? null} />
          ))}
        </div>
      </section>
      {idleList}
    </div>
  )
}

/**
 * Apps with no sessions this week, one row each in one card: name, the same
 * badge the card would carry and when the last bug came in.
 */
function NoSessionsList({ cards, recipeWorst }: { cards: ProjectCard[]; recipeWorst: ReadonlyMap<string, ElementState> }) {
  return (
    <Card className="overflow-hidden" data-testid="overview-no-sessions">
      <h3 className="border-b border-edge px-4 py-2 text-xs font-semibold text-fg-secondary">
        No sessions this week ({cards.length})
      </h3>
      <ul className="divide-y divide-edge">
        {cards.map((card) => {
          const tone = healthToneFor(card)
          const badge = healthBadgeLabel(card, tone)
          const worst = recipeWorst.get(card.project_id) ?? null
          const pick = () => setActiveProjectIdSnapshot(card.project_id)
          return (
            <li key={card.project_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
              <Link to="/dashboard" onClick={pick} className="min-w-0 truncate text-sm font-medium text-fg hover:underline" title={card.slug ?? undefined}>
                {card.label}
              </Link>
              {badge && (
                <Link to={card.open_reports > 0 ? '/reports?status=open' : '/reports'} onClick={pick} aria-label={`${badge}: open this app's bugs`}>
                  <Badge tone={HEALTH_BADGE_TONE[tone]} title={HEALTH_BADGE_HINT[tone]}>
                    {badge}
                  </Badge>
                </Link>
              )}
              {worst && (
                <Link to="/recipe" onClick={pick} className="inline-flex items-center gap-1 text-2xs text-fg-muted hover:text-fg" aria-label="Open this project's recipe">
                  <span>Recipe</span>
                  <RecipeStateChip state={worst} />
                </Link>
              )}
              {card.last_report_at && (
                <span className="ml-auto text-fg-faint" title={`Last bug report ${card.last_report_at}`}>
                  last bug {relTime(card.last_report_at)}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ─── Project health card ──────────────────────────────────────────────────────

function ProjectHealthCard({ card, recipeWorst }: { card: ProjectCard; recipeWorst: ElementState | null }) {
  const dauValues = (card.dau_spark ?? []).map((p) => p.dau)
  const healthTone = healthToneFor(card)
  const badge = healthBadgeLabel(card, healthTone)
  const hasSessions = card.sessions_7d > 0

  const handleSwitchProject = () => {
    setActiveProjectIdSnapshot(card.project_id)
  }

  // `not-connected` deliberately keeps the neutral edge — a project created
  // five minutes ago is not an error, and painting it amber would cry wolf.
  // The badge carries the state; the border is reserved for real trouble.
  const borderTone =
    healthTone === 'critical'
      ? 'border-danger/40'
      : healthTone === 'silent'
        ? 'border-warn/40'
        : ''

  return (
    <Card
      className={`group relative flex flex-col overflow-hidden transition-shadow hover:shadow-sm ${borderTone}`}
    >
      {/* Header — the title is the stretched primary target (WCAG 2.5.8):
          the whole card opens this app's Home, so the footer's "Home" link
          and the slug under the name (a repeat of it) are gone (round-2 sweep 2026-11-18). */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg" title={card.slug ?? undefined}>
            <Link
              to="/dashboard"
              onClick={handleSwitchProject}
              className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm"
            >
              {card.label}
            </Link>
          </h3>
        </div>
        {badge && (
          <Link
            to={card.open_reports > 0 ? '/reports?status=open' : '/reports'}
            onClick={handleSwitchProject}
            className="relative z-10 shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            aria-label={`${badge}: open this app's bugs`}
          >
            <Badge tone={HEALTH_BADGE_TONE[healthTone]} title={HEALTH_BADGE_HINT[healthTone]}>
              {badge}
            </Badge>
          </Link>
        )}
      </div>

      {/* Sessions a day; the ringed last bar is today so far. */}
      {hasSessions && dauValues.length > 0 && (
        <div className="mt-3 px-4">
          <BarSparkline
            values={dauValues}
            height={32}
            ariaLabel={`Sessions a day, last ${dauValues.length} days; the last bar is today so far`}
            barTitles={(card.dau_spark ?? []).map((p, i, all) => `${p.day}: ${p.dau} sessions${i === all.length - 1 ? ' (today so far)' : ''}`)}
          />
          <p className="mt-1 text-3xs text-fg-faint">Sessions a day, last {dauValues.length} d · last bar is today so far</p>
        </div>
      )}

      {/* One link row: the numbers open User activity; z-10 above the stretched title link. */}
      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge px-4 py-3 text-xs text-fg-muted">
        {hasSessions ? (
          <Link
            to="/portfolio?view=users"
            onClick={handleSwitchProject}
            className="inline-flex min-h-6 items-center gap-4 rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            title="Open User activity for this app"
          >
            <span>
              <span className="font-medium text-fg">{fmt(card.sessions_7d)}</span> sessions
            </span>
            <span>
              <span className="font-medium text-fg">{fmt(card.users_7d)}</span> users
            </span>
          </Link>
        ) : (
          <span className="inline-flex min-h-6 items-center text-fg-faint" data-testid="overview-no-sessions">
            No sessions this week
          </span>
        )}
        {card.last_report_at && (
          <span className="ml-auto text-fg-faint" title={`Last bug report ${card.last_report_at}`}>
            last bug {relTime(card.last_report_at)}
          </span>
        )}
        {recipeWorst && (
          <Link
            to="/recipe"
            onClick={handleSwitchProject}
            className="inline-flex min-h-6 items-center gap-1 rounded-sm text-2xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            aria-label="Open this project's recipe"
          >
            <span>Recipe</span>
            <RecipeStateChip state={recipeWorst} />
          </Link>
        )}
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
