/**
 * PortfolioPage — every app in the active team at once (Plan 019 Phase P1,
 * Plan 020 Phase 1 columns).
 *
 * One card per project: the worst recipe state, open reports, the Mushi SDK
 * against the latest release, the hole checks (radar) and, in Advanced mode,
 * Mushi's own LLM spend. Below the grid: problems open in 2+ projects ("fix
 * once"), SDK versions, and integrations most siblings have but one lacks.
 *
 * Data: GET /v1/admin/orgs/:orgId/portfolio → PortfolioResponse
 *       GET /v1/admin/orgs/:orgId/portfolio/findings → PortfolioFindingsResponse
 * Empty, loading, error and "not checked yet" states are explicit; nothing
 * that was never checked renders as healthy.
 */

import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { Badge, Btn, Card, CopyButton, EmptyState, FreshnessPill, Loading, Section, StatCard, StatGrid } from '../components/ui'
import { RecipeStateChip } from '../components/recipe/RecipeStateChip'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { usePageData, type PageDataState } from '../lib/usePageData'
import { useAdminMode } from '../lib/mode'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { setActiveProjectIdSnapshot } from '../lib/activeProject'
import type { PortfolioCard, PortfolioFindingsResponse, PortfolioResponse } from '../lib/portfolioTypes'
import { formatUsd, kindLabel, radarLabel, sdkLabel, sortPortfolioCards } from '../components/portfolio/portfolioView'

export function PortfolioPage() {
  const orgId = useActiveOrgId()
  if (!orgId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar title="Portfolio" />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState title="No team selected" description="Pick a team in the switcher at the top to see all of its apps." />
        </div>
      </div>
    )
  }
  return <OrgPortfolio key={orgId} orgId={orgId} />
}

function OrgPortfolio({ orgId }: { orgId: string }) {
  const path = `/v1/admin/orgs/${orgId}/portfolio`
  const page = usePageData<PortfolioResponse>(path)
  const findings = usePageData<PortfolioFindingsResponse>(`${path}/findings`)
  const { isAdvanced } = useAdminMode()
  const cards = useMemo(() => sortPortfolioCards(page.data?.cards ?? []), [page.data])
  const names = useMemo(() => new Map((page.data?.cards ?? []).map((c) => [c.projectId, c.name])), [page.data])
  const needsLook = cards.filter((c) => c.worst !== 'ok').length

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-portfolio">
      <PageHeaderBar
        title="Portfolio"
        description="All your apps in one place: what is broken, drifting or behind, and what to fix once for all of them."
        helpTitle="About Portfolio"
        helpWhatIsIt="Each card is one app's recipe at a glance, plus its open reports, its Mushi SDK version and its hole checks. Below the cards are problems that show up in two or more apps, so you can fix them once."
        helpHowToUse="Start with the worst card. Not checked yet means Mushi has not looked; it is never a pass. Copy a fix-once prompt into your editor to fix the same problem in every repo."
        helpFlowPath="/portfolio"
      >
        <FreshnessPill at={page.lastFetchedAt} isValidating={page.isValidating} />
        <Btn size="sm" variant="ghost" onClick={() => { page.reload(); findings.reload() }} loading={page.isValidating}>
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: Boolean(page.data && page.data.cards.length > 0),
            children: page.data ? (
              <StatGrid>
                <StatCard label="Apps" value={String(page.data.totalProjects)} />
                <StatCard label="Need a look" value={String(needsLook)} accent={needsLook > 0 ? 'text-warn' : undefined} />
                <StatCard label="Fix once" value={String(page.data.repeatedGroups)} hint="Problems open in two or more apps" />
                <StatCard label="Missing setups" value={String(page.data.holes)} hint="Integrations most of your other apps have" />
              </StatGrid>
            ) : null,
          },
        ]}
      />

      {page.loading && !page.data && <Loading text="Reading every app's recipe…" />}
      {page.error && (
        <PageLoadError error={page.error} code={page.errorCode} resource="portfolio" endpoint={page.errorEndpoint} requestId={page.requestId} onRetry={page.reload} />
      )}
      {page.data && page.data.cards.length === 0 && (
        <Card className="px-4 py-8 text-center text-sm text-fg-faint">
          <p className="font-medium text-fg-muted">No apps in this team yet</p>
          <p className="mt-1 text-xs">
            <Link to="/onboarding" className="text-brand hover:underline">Connect your first app →</Link>
          </p>
        </Card>
      )}
      {cards.length > 0 && (
        <PanelErrorBoundary label="Portfolio cards">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <PortfolioCardTile key={card.projectId} card={card} showSpend={isAdvanced} />
            ))}
          </div>
        </PanelErrorBoundary>
      )}

      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Fix once">
          <FindingsSections findings={findings} names={names} />
        </PanelErrorBoundary>
      )}
    </div>
  )
}

function PortfolioCardTile({ card, showSpend }: { card: PortfolioCard; showSpend: boolean }) {
  const radar = radarLabel(card.radar)
  const sdk = sdkLabel(card.sdk)
  const open = () => setActiveProjectIdSnapshot(card.projectId)
  return (
    <Card className="relative flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">
            <Link to="/recipe" onClick={open} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              {card.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-2xs text-fg-faint">{kindLabel(card)}</p>
        </div>
        <RecipeStateChip state={card.worst} className="shrink-0" />
      </div>
      {card.error && <p className="text-xs text-danger" role="status">{card.error}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={radar.tone} title={radar.hint}>{radar.text}</Badge>
        <Badge tone={sdk.tone} title={sdk.hint}>{sdk.text}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
        <dt>Open reports</dt>
        <dd className="text-right font-medium text-fg">{card.openReports}</dd>
        <dt>Latest release</dt>
        <dd className="truncate text-right text-fg">{card.latestRelease?.version ?? 'None yet'}</dd>
        {showSpend && (
          <>
            <dt>Mushi AI spend (30 days)</dt>
            <dd className="text-right text-fg">{formatUsd(card.spend.llmUsd30d)}</dd>
            <dt>Monthly AI budget</dt>
            <dd className="text-right text-fg">{card.spend.monthlyLlmBudgetUsd == null ? 'Not set' : formatUsd(card.spend.monthlyLlmBudgetUsd)}</dd>
          </>
        )}
      </dl>
      <div className="mt-auto flex gap-3 border-t border-edge pt-2 text-2xs">
        <Link to="/recipe" onClick={open} className="text-brand hover:underline">Recipe →</Link>
        <Link to="/reports" onClick={open} className="text-fg-muted hover:text-fg hover:underline">Reports</Link>
      </div>
    </Card>
  )
}

function FindingsSections({ findings, names }: { findings: PageDataState<PortfolioFindingsResponse>; names: Map<string, string> }) {
  if (findings.loading && !findings.data) return <Loading text="Looking for problems shared across apps…" />
  if (findings.error) {
    return <PageLoadError error={findings.error} code={findings.errorCode} resource="shared problems" endpoint={findings.errorEndpoint} requestId={findings.requestId} onRetry={findings.reload} />
  }
  const data = findings.data
  if (!data) return null
  const name = (id: string) => names.get(id) ?? id.slice(0, 8)
  const behind = data.sdkSkew.filter((e) => e.status !== 'current')
  return (
    <div className="flex flex-col gap-4">
      <Section title="Fix once">
        {data.groups.length === 0 ? (
          <p className="text-sm text-fg-muted">No problem is open in two or more apps right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.groups.map((g) => (
              <li key={g.ruleId} className="flex flex-col gap-1 rounded-md border border-edge-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    <code className="font-mono text-xs">{g.ruleId}</code> in {g.projectIds.length} apps
                    <Badge tone={g.severity === 'error' ? 'dangerSubtle' : 'warnSubtle'} className="ml-2">{g.severity === 'error' ? 'Serious' : 'Look at'}</Badge>
                  </p>
                  <p className="truncate text-xs text-fg-muted">{g.projectIds.map(name).join(', ')}</p>
                </div>
                <CopyButton value={g.suggestedFix} label="Copy fix prompt" />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Mushi SDK versions">
        {behind.length === 0 ? (
          <p className="text-sm text-fg-muted">Every app that reported is on the latest Mushi SDK.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {behind.map((e) => (
              <li key={`${e.projectId}:${e.package ?? 'none'}`} className="flex flex-wrap gap-2">
                <span className="font-medium text-fg">{name(e.projectId)}</span>
                {e.package && <code className="font-mono text-xs text-fg-muted">{e.package}</code>}
                <span className="text-fg-muted">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Missing setups">
        {data.holes.length === 0 ? (
          <p className="text-sm text-fg-muted">No app is missing something most of your other apps have.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.holes.map((h) => (
              <li key={`${h.projectId}:${h.integration}`}>
                <span className="font-medium text-fg">{name(h.projectId)}</span>{' '}
                <span className="text-fg-muted">{h.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
