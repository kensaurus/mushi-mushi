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
 *       GET /v1/admin/orgs/:orgId/monetization (MonetizationCard)
 *       GET /v1/admin/ci/overview?days=7 (CiRunnersCard)
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
import { Badge, Btn, Callout, Card, CopyButton, EmptyState, FreshnessPill, Loading, PageStatus, Section } from '../components/ui'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { usePageData, type PageDataState } from '../lib/usePageData'
import { useAdminMode } from '../lib/mode'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import type { PortfolioCard, PortfolioFindingsResponse, PortfolioReadError, PortfolioResponse } from '../lib/portfolioTypes'
import { appUrgency, findingGroupTitle, needsALook, portfolioStatusSentence, sortPortfolioCards } from '../components/portfolio/portfolioView'
import { setActiveProjectIdSnapshot } from '../lib/activeProject'
import { DigestCard } from '../components/portfolio/DigestCard'
import { ConnectorsCard } from '../components/portfolio/ConnectorsCard'
import { MonetizationCard } from '../components/portfolio/MonetizationCard'
import { SharedResourcesCard } from '../components/portfolio/SharedResourcesCard'
import { ReleasesCard } from '../components/portfolio/ReleasesCard'
import { FunnelCard } from '../components/portfolio/FunnelCard'
import { AccountsRegisterCard } from '../components/portfolio/AccountsRegisterCard'
import { SpendLedgerCard } from '../components/portfolio/SpendLedgerCard'
import { CiRunnersCard } from '../components/portfolio/CiRunnersCard'
import { PortfolioCardTile, PortfolioCompactRow } from '../components/portfolio/PortfolioCardTile'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useProjectSnapshots } from '../lib/useProjectSnapshots'
import { faviconSourceFromProject } from '../lib/resolveProjectDomain'
import type { ProjectFaviconSource } from '@mushi-mushi/core'
import { ProjectGroupsBar } from '../components/portfolio/ProjectGroupsBar'
import { readActiveGroup, useProjectGroups, writeActiveGroup } from '../lib/projectGroups'
import { PROJECT_DIRECTORY_PATH, type ProjectDirectory } from '../lib/crossTeamProject'

export function PortfolioPage() {
  const orgId = useActiveOrgId()
  if (!orgId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar title="Apps" />
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
  // Only a requested group needs the group list first (a remembered group may
  // have been deleted). Without one the path is already final, so the
  // portfolio reads start at once instead of queuing behind project-groups.
  const waitForGroups = requested != null && groups.loading && !groups.data
  const page = usePageData<PortfolioResponse>(waitForGroups ? null : path)
  const findings = usePageData<PortfolioFindingsResponse>(waitForGroups ? null : `${base}/findings${query}`)
  const { isAdvanced } = useAdminMode()
  const cards = useMemo(() => sortPortfolioCards(page.data?.cards ?? []), [page.data])
  const names = useMemo(() => new Map((page.data?.cards ?? []).map((c) => [c.projectId, c.name])), [page.data])
  const status = useMemo(() => portfolioStatusSentence(cards), [cards])
  const openBugs = useMemo(() => cards.reduce((n, c) => n + c.openReports, 0), [cards])
  const firstNext = status.first ? appUrgency(status.first).next : null
  // Apps that need a look get a full card; the rest collapse to one row each.
  const attention = useMemo(() => cards.filter(needsALook), [cards])
  const healthy = useMemo(() => cards.filter((c) => !needsALook(c)), [cards])
  const appList = useMemo(() => cards.map((c) => ({ projectId: c.projectId, name: c.name })), [cards])
  // App icons: the team's project list knows each app's SDK origin and repo.
  const setup = useSetupStatus()
  const snapshots = useProjectSnapshots()
  const faviconFor = (card: PortfolioCard): ProjectFaviconSource => {
    const known = setup.data?.projects.find((p) => p.project_id === card.projectId)
    const base = known
      ? faviconSourceFromProject(known, snapshots.byId.get(card.projectId))
      : { project_id: card.projectId, project_name: card.name, project_slug: card.slug ?? '' }
    // The store icon from the portfolio read wins; the favicon and initials follow.
    return card.iconUrl ? { ...base, icon_url: card.iconUrl } : base
  }

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-portfolio">
      <PageHeaderBar
        title="Apps"
        description="All your apps in one place: what is broken, out of date or behind, and what to fix once for all of them."
        helpTitle="About apps"
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
              <PageStatus
                sentence={status.sentence}
                tone={status.tone}
                ariaLabel="Apps status"
                metrics={[
                  { label: 'Need you', value: cards.filter(needsALook).length, hint: 'Apps that are broken, have open bugs, or have a part to fix. SDK updates and Mushi setup chores do not count.' },
                  { label: 'Open bugs', value: openBugs, hint: 'Open bug reports across these apps.' },
                  { label: 'Fix once', value: page.data.repeatedGroups, hint: 'Problems open in two or more apps, fixed with one prompt.' },
                ]}
                action={
                  status.first && firstNext ? (
                    <Btn size="sm" variant="primary" to={firstNext.to} onClick={() => setActiveProjectIdSnapshot(status.first!.projectId)}>
                      Fix {status.first.name}
                    </Btn>
                  ) : undefined
                }
              />
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
      {cards.length > 0 && page.data && (
        <>
          <PortfolioSectionNav />
          <section id="portfolio-apps" aria-labelledby="portfolio-apps-title" className="scroll-mt-20 space-y-3">
            <h2 id="portfolio-apps-title" className="text-sm font-semibold text-fg">Apps</h2>
            <PanelErrorBoundary label="Portfolio cards">
              {attention.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {attention.map((card) => (
                    <PortfolioCardTile key={card.projectId} card={card} favicon={faviconFor(card)} showSpend={isAdvanced} />
                  ))}
                </div>
              )}
              {healthy.length > 0 && (
                <Card className="p-0">
                  <p className="border-b border-edge px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-muted">
                    Nothing urgent ({healthy.length})
                  </p>
                  <ul className="divide-y divide-edge">
                    {healthy.map((card) => (
                      <PortfolioCompactRow key={card.projectId} card={card} favicon={faviconFor(card)} />
                    ))}
                  </ul>
                </Card>
              )}
            </PanelErrorBoundary>
            <PanelErrorBoundary label="Fix once">
              <FindingsSections findings={findings} names={names} />
            </PanelErrorBoundary>
          </section>

          <section id="portfolio-releases" aria-labelledby="portfolio-releases-title" className="scroll-mt-20 space-y-3">
            <h2 id="portfolio-releases-title" className="text-sm font-semibold text-fg">Releases</h2>
            <PanelErrorBoundary label="Releases">
              <ReleasesCard orgId={orgId} />
            </PanelErrorBoundary>
            <PanelErrorBoundary label="Funnel across apps">
              <FunnelCard orgId={orgId} />
            </PanelErrorBoundary>
            <PanelErrorBoundary label="CI runners">
              <CiRunnersCard />
            </PanelErrorBoundary>
          </section>

          <section id="portfolio-payments" aria-labelledby="portfolio-payments-title" className="scroll-mt-20 space-y-3">
            <h2 id="portfolio-payments-title" className="text-sm font-semibold text-fg">Payments</h2>
            <PanelErrorBoundary label="Payments across apps">
              <MonetizationCard orgId={orgId} />
            </PanelErrorBoundary>
          </section>

          <section id="portfolio-spend" aria-labelledby="portfolio-spend-title" className="scroll-mt-20 space-y-3">
            <h2 id="portfolio-spend-title" className="text-sm font-semibold text-fg">Spend & accounts</h2>
            <PanelErrorBoundary label="Spend per app">
              <SpendLedgerCard orgId={orgId} projects={appList} />
            </PanelErrorBoundary>
            <PanelErrorBoundary label="Accounts and resilience">
              <AccountsRegisterCard orgId={orgId} />
            </PanelErrorBoundary>
            <PanelErrorBoundary label="Shared resources">
              <SharedResourcesCard orgId={orgId} names={names} />
            </PanelErrorBoundary>
            <PanelErrorBoundary label="Connected sources">
              <ConnectorsCard orgId={orgId} projects={appList} />
            </PanelErrorBoundary>
          </section>

          <section id="portfolio-digest" aria-labelledby="portfolio-digest-title" className="scroll-mt-20 space-y-3">
            <h2 id="portfolio-digest-title" className="text-sm font-semibold text-fg">Digest</h2>
            <PanelErrorBoundary label="Daily digest">
              <DigestCard orgId={orgId} projects={appList} />
            </PanelErrorBoundary>
          </section>
        </>
      )}
    </div>
  )
}

/** In-page sub-nav: the page is five sections long, so jump instead of scrolling. */
const PORTFOLIO_SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'portfolio-apps', label: 'Apps' },
  { id: 'portfolio-releases', label: 'Releases' },
  { id: 'portfolio-payments', label: 'Payments' },
  { id: 'portfolio-spend', label: 'Spend & accounts' },
  { id: 'portfolio-digest', label: 'Digest' },
]

function PortfolioSectionNav() {
  return (
    <nav aria-label="On this page" className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-x-4 gap-y-1 border-b border-edge bg-surface-root/95 px-1 py-2 text-xs backdrop-blur">
      {PORTFOLIO_SECTIONS.map((s) => (
        <a key={s.id} href={`#${s.id}`} className="text-fg-muted hover:text-fg hover:underline">
          {s.label}
        </a>
      ))}
    </nav>
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
