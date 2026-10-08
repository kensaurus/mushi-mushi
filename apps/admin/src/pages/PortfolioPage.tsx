/**
 * PortfolioPage — every app in the active team at once (Plan 019 Phase P1,
 * Plan 020 Phase 1 columns).
 *
 * One card per project: the worst recipe state with the parts behind it named
 * (`needsLook`), open reports, the Mushi SDK against the latest release, the
 * risk checks (radar) and, in Advanced mode, Mushi's own LLM spend. Below the
 * grid: problems open in 2+ projects ("fix once"), SDK versions, and
 * integrations most siblings have but one lacks.
 *
 * Data: GET /v1/admin/orgs/:orgId/portfolio → PortfolioResponse
 *       GET /v1/admin/orgs/:orgId/portfolio/findings → PortfolioFindingsResponse
 *       GET /v1/admin/orgs/:orgId/releases (ReleasesCard)
 *       GET|PUT /v1/admin/orgs/:orgId/funnel (FunnelCard)
 *       GET|POST|PATCH|DELETE /v1/admin/orgs/:orgId/accounts (AccountsRegisterCard)
 *       GET /v1/admin/orgs/:orgId/spend + bill imports (SpendLedgerCard)
 * Empty, loading, error and "not checked yet" states are explicit; nothing
 * that was never checked renders as healthy. A read the server could not
 * finish is listed in a callout (`readErrors`) and its cells read "Could not
 * read" (`card.unreadable`), never $0, "Not set" or "None yet".
 */

import { Link, useSearchParams } from 'react-router-dom'
import { useMemo } from 'react'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { Badge, Btn, Callout, Card, CopyButton, EmptyState, FreshnessPill, Loading, Section, StatCard, StatGrid } from '../components/ui'
import { RecipeStateChip } from '../components/recipe/RecipeStateChip'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { usePageData, type PageDataState } from '../lib/usePageData'
import { useAdminMode } from '../lib/mode'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { setActiveProjectIdSnapshot } from '../lib/activeProject'
import type { PortfolioCard, PortfolioFindingsResponse, PortfolioReadError, PortfolioResponse } from '../lib/portfolioTypes'
import {
  budgetText,
  cardNeedsLook,
  findingGroupTitle,
  kindLabel,
  needsALook,
  openReportsText,
  radarLabel,
  releaseText,
  sdkLabel,
  sortPortfolioCards,
  spendText,
} from '../components/portfolio/portfolioView'
import { DigestCard } from '../components/portfolio/DigestCard'
import { ConnectorsCard } from '../components/portfolio/ConnectorsCard'
import { SharedResourcesCard } from '../components/portfolio/SharedResourcesCard'
import { ReleasesCard } from '../components/portfolio/ReleasesCard'
import { FunnelCard } from '../components/portfolio/FunnelCard'
import { AccountsRegisterCard } from '../components/portfolio/AccountsRegisterCard'
import { SpendLedgerCard } from '../components/portfolio/SpendLedgerCard'
import { ProjectGroupsBar } from '../components/portfolio/ProjectGroupsBar'
import { readActiveGroup, useProjectGroups, writeActiveGroup } from '../lib/projectGroups'
import { PROJECT_DIRECTORY_PATH, type ProjectDirectory } from '../lib/crossTeamProject'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const groups = useProjectGroups(orgId)
  const groupList = groups.data?.groups ?? []
  const requested = searchParams.get('group') ?? readActiveGroup()
  // A remembered group that was deleted (or belongs to another team) falls back to all apps.
  const group = requested && groupList.some((g) => g.slug === requested) ? requested : null
  const directory = usePageData<ProjectDirectory>(PROJECT_DIRECTORY_PATH, { scope: 'none' })
  const teamApps = useMemo(
    () => (directory.data?.projects ?? []).filter((p) => p.organizationId === orgId).map((p) => ({ projectId: p.id, name: p.name })),
    [directory.data, orgId],
  )
  const selectGroup = (slug: string | null) => {
    writeActiveGroup(slug)
    const next = new URLSearchParams(searchParams)
    if (slug) next.set('group', slug)
    else next.delete('group')
    setSearchParams(next, { replace: true })
  }
  const base = `/v1/admin/orgs/${orgId}/portfolio`
  const query = group ? `?group=${encodeURIComponent(group)}` : ''
  const path = `${base}${query}`
  const page = usePageData<PortfolioResponse>(groups.loading && !groups.data ? null : path)
  const findings = usePageData<PortfolioFindingsResponse>(groups.loading && !groups.data ? null : `${base}/findings${query}`)
  const { isAdvanced } = useAdminMode()
  const cards = useMemo(() => sortPortfolioCards(page.data?.cards ?? []), [page.data])
  const names = useMemo(() => new Map((page.data?.cards ?? []).map((c) => [c.projectId, c.name])), [page.data])
  const needsLook = cards.filter(needsALook).length

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-portfolio">
      <PageHeaderBar
        title="Portfolio"
        description="All your apps in one place: what is broken, out of date or behind, and what to fix once for all of them."
        helpTitle="About Portfolio"
        helpWhatIsIt="Each card is one app at a glance: what needs attention and why, its open reports, its Mushi SDK version and its risk checks. Below the cards are problems that show up in two or more apps, so you can fix them once."
        helpHowToUse="Start with the first card: it lists what needs attention and what to do. Not checked yet means Mushi has not looked; it is never a pass. Copy a fix-once prompt into your editor to fix the same problem in every repo."
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
                <StatCard label="Need a look" value={String(needsLook)} accent={needsLook > 0 ? 'text-warn' : undefined} hint="Apps with something to fix or not yet checked" />
                <StatCard label="Fix once" value={String(page.data.repeatedGroups)} hint="Problems open in two or more apps" />
                <StatCard
                  label="Missing setups"
                  value={page.data.holes === null ? '—' : String(page.data.holes)}
                  hint={page.data.holes === null ? 'Could not read which integrations each app has' : 'Integrations most of your other apps have'}
                />
              </StatGrid>
            ) : null,
          },
        ]}
      />

      {groups.data && (
        <ProjectGroupsBar
          orgId={orgId}
          groups={groupList}
          apps={teamApps}
          active={group}
          onSelect={selectGroup}
          onChanged={() => {
            groups.reload()
            page.reload()
            findings.reload()
          }}
        />
      )}

      {page.loading && !page.data && <Loading text="Reading every app's recipe…" />}
      {page.error && (
        <PageLoadError error={page.error} code={page.errorCode} resource="portfolio" endpoint={page.errorEndpoint} requestId={page.requestId} onRetry={page.reload} />
      )}
      {page.data && page.data.readErrors.length > 0 && <ReadErrorsCallout errors={page.data.readErrors} />}
      {page.data && page.data.cards.length === 0 && (
        <Card className="px-4 py-8 text-center text-sm text-fg-faint">
          <p className="font-medium text-fg-muted">{group ? 'No apps in this group yet' : 'No apps in this team yet'}</p>
          <p className="mt-1 text-xs">
            {group ? (
              'Open Manage groups above to choose its apps.'
            ) : (
              <Link to="/onboarding" className="text-brand hover:underline">Connect your first app →</Link>
            )}
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
      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Spend per app">
          <SpendLedgerCard orgId={orgId} projects={page.data.cards.map((c) => ({ projectId: c.projectId, name: c.name }))} />
        </PanelErrorBoundary>
      )}
      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Daily digest">
          <DigestCard orgId={orgId} projects={page.data.cards.map((c) => ({ projectId: c.projectId, name: c.name }))} />
        </PanelErrorBoundary>
      )}
      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Funnel across apps">
          <FunnelCard orgId={orgId} />
        </PanelErrorBoundary>
      )}
      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Releases">
          <ReleasesCard orgId={orgId} />
        </PanelErrorBoundary>
      )}
      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Shared resources">
          <SharedResourcesCard orgId={orgId} names={names} />
        </PanelErrorBoundary>
      )}
      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Accounts and resilience">
          <AccountsRegisterCard orgId={orgId} />
        </PanelErrorBoundary>
      )}
      {page.data && page.data.cards.length > 0 && (
        <PanelErrorBoundary label="Connected sources">
          <ConnectorsCard orgId={orgId} projects={page.data.cards.map((c) => ({ projectId: c.projectId, name: c.name }))} />
        </PanelErrorBoundary>
      )}
    </div>
  )
}

const MAX_NAMED_PROBLEMS = 2

function PortfolioCardTile({ card, showSpend }: { card: PortfolioCard; showSpend: boolean }) {
  const radar = radarLabel(card.radar, card.unreadable)
  const sdk = sdkLabel(card.sdk, card.unreadable)
  const problems = cardNeedsLook(card)
  const shown = problems.slice(0, MAX_NAMED_PROBLEMS)
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
          <p className="mt-0.5 text-xs text-fg-faint">{kindLabel(card)}</p>
        </div>
        <RecipeStateChip state={card.worst} className="shrink-0" />
      </div>
      {card.error && <p className="text-xs text-danger" role="status">{card.error}</p>}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="What needs attention">
          {shown.map((p) => (
            <li key={p.element} className="text-xs leading-snug">
              <span className="font-medium text-fg">{p.label}:</span> <span className="text-fg-secondary">{p.reason}</span>
            </li>
          ))}
          {problems.length > shown.length && (
            <li className="text-xs text-fg-muted">
              +{problems.length - shown.length} more on the{' '}
              <Link to="/recipe" onClick={open} className="text-brand hover:underline">Recipe page</Link>
            </li>
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={radar.tone} title={radar.hint}>{radar.text}</Badge>
        <Badge tone={sdk.tone} title={sdk.hint}>{sdk.text}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
        <dt>Open reports</dt>
        <dd className="text-right font-medium text-fg">{openReportsText(card)}</dd>
        <dt>Latest release</dt>
        <dd className="truncate text-right text-fg">{releaseText(card)}</dd>
        {showSpend && (
          <>
            <dt>Mushi AI spend (30 days)</dt>
            <dd className="text-right text-fg">{spendText(card)}</dd>
            <dt>Monthly AI budget</dt>
            <dd className="text-right text-fg">{budgetText(card)}</dd>
          </>
        )}
      </dl>
      <div className="mt-auto flex gap-3 border-t border-edge pt-2 text-xs">
        <Link to="/recipe" onClick={open} className="text-brand hover:underline">Open recipe →</Link>
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
  const failed = (part: PortfolioReadError['part']) => data.readErrors.find((e) => e.part === part && e.kind === 'failed')
  const sdkFailed = failed('sdk')
  const holesFailed = failed('integrations')
  return (
    <div className="flex flex-col gap-4">
      {data.readErrors.length > 0 && <ReadErrorsCallout errors={data.readErrors} />}
      <Section title="Fix once">
        {data.groups.length === 0 ? (
          <p className="text-sm text-fg-muted">No problem is open in two or more apps right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.groups.map((g) => (
              <li key={g.ruleId} className="flex flex-col gap-2 rounded-md border border-edge-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-fg" title={g.ruleId}>
                    {findingGroupTitle(g)}
                    <Badge tone={g.severity === 'error' ? 'dangerSubtle' : 'warnSubtle'} className="ml-2">
                      {g.severity === 'error' ? 'Serious' : 'Look at'} · {g.projectIds.length} apps
                    </Badge>
                  </p>
                  {g.title && g.sampleMessage && <p className="text-xs text-fg-secondary">{g.sampleMessage}</p>}
                  <p className="text-xs text-fg-muted">
                    {g.gateLabel ? `${g.gateLabel} · ` : ''}
                    {g.projectIds.map(name).join(', ')}
                  </p>
                </div>
                <CopyButton value={g.suggestedFix} label="Copy fix prompt" />
              </li>
            ))}
          </ul>
        )}
      </Section>
      {data.crossProject.length > 0 && (
        <Section title="Across your apps">
          <ul className="flex flex-col gap-2">
            {data.crossProject.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 rounded-md border border-edge-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{f.message}</p>
                  <p className="truncate text-xs text-fg-muted">{f.projectIds.map(name).join(', ')}</p>
                </div>
                {f.suggestedFix && <CopyButton value={`${f.message}\n\nFix: ${f.suggestedFix}`} label="Copy fix prompt" />}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Mushi SDK versions">
        {sdkFailed ? (
          <p className="text-sm text-danger" role="status">{sdkFailed.message}</p>
        ) : behind.length === 0 ? (
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
        {holesFailed ? (
          <p className="text-sm text-danger" role="status">{holesFailed.message}</p>
        ) : data.holes.length === 0 ? (
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

/** Reads the server could not finish: their columns are unknown, not empty or zero. */
function ReadErrorsCallout({ errors }: { errors: PortfolioReadError[] }) {
  return (
    <Callout tone="warn" label="Some of this could not be read">
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-fg-secondary" role="status">
        {errors.map((e) => (
          <li key={`${e.part}:${e.kind}`}>{e.message}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-fg-muted">Cells that depend on these read "Could not read". Refresh in a minute.</p>
    </Callout>
  )
}
