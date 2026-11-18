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
 * Signal pass (2026-11-18, the CI page's visual language): the headline is a
 * ranking (lib/appSignals), the worst three apps lead as alert cards, and an
 * apps × signals heat grid ("Table", the default) or the cards ("Cards", the
 * choice kept in localStorage) follow. One HighlightProvider lights an app's
 * alert, grid row and card together (key `app:<projectId>`).
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

import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary'
import { Btn, Card, EmptyState, FreshnessPill, Loading, PageStatus, SegmentedControl } from '../components/ui'
import { TabbedSubNav } from '../components/TabbedSubNav'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { usePageData } from '../lib/usePageData'
import { apiFetch } from '../lib/supabase'
import { useAdminMode } from '../lib/mode'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import type { PortfolioCard, PortfolioFindingsResponse, PortfolioResponse } from '../lib/portfolioTypes'
import { needsALook, sortPortfolioCards, splitPublicDemo, type PortfolioSort } from '../components/portfolio/portfolioView'
import { PortfolioFindings, ReadErrorsCallout } from '../components/portfolio/PortfolioFindings'
import { appLink, openApp } from '../lib/openApp'
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
import { HighlightProvider } from '../components/signal/linkedHighlight'
import { AlertCards } from '../components/signal/AlertCards'
import { AppSignalGrid } from '../components/portfolio/AppSignalGrid'
import { appAlerts, lastCheckIns, rankApps, rankingSentence } from '../lib/appSignals'

/** Table (the heat grid) or Cards: remembered per browser. */
type PortfolioView = 'table' | 'cards'
const VIEW_STORAGE_KEY = 'mushi:portfolio:view'

function readView(): PortfolioView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'cards' ? 'cards' : 'table'
  } catch {
    return 'table'
  }
}

/**
 * The page's sections are real tabs on `?tab=` (2026-11-18; they used to be anchor links over
 * one endless scroll). Apps is the default and drops the param; an unknown value is Apps.
 */
const PORTFOLIO_TABS = [
  { id: 'apps', label: 'Apps' },
  { id: 'releases', label: 'Releases' },
  { id: 'payments', label: 'Payments' },
  { id: 'spend', label: 'Spend & accounts' },
  { id: 'digest', label: 'Digest' },
] as const
type PortfolioTab = (typeof PORTFOLIO_TABS)[number]['id']

function resolvePortfolioTab(param: string | null): PortfolioTab {
  return PORTFOLIO_TABS.find((t) => t.id === param)?.id ?? 'apps'
}

function writeView(view: PortfolioView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    /* Storage off (private window, blocked): the choice lasts this visit. */
  }
}

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
  const location = useLocation()
  const tab = resolvePortfolioTab(searchParams.get('tab'))
  // Links, not replace: each tab is a history entry, so back and forward move between them.
  const tabHref = (id: PortfolioTab) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'apps') next.delete('tab')
    else next.set('tab', id)
    const qs = next.toString()
    return `${location.pathname}${qs ? `?${qs}` : ''}`
  }
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
  // Each tab reads only its own routes, and none waits for the portfolio read
  // (about 8 s on a big team): Spend's, Payments' and Digest's cards mount at
  // once and start beside it (2026-11-18). Fix once belongs to the Apps tab.
  const findings = usePageData<PortfolioFindingsResponse>(waitForGroups || tab !== 'apps' ? null : `${base}/findings${query}`)
  const { isAdvanced } = useAdminMode()
  // Refresh also looks up the app icons again (a new store icon shows now,
  // not after the daily check). The flagged request answers the whole
  // portfolio, so the page shows that answer: ONE read per Refresh. It used
  // to follow it with page.reload(), a second full read (2026-11-18). The
  // flag stays out of the cached path; the newer of the two answers shows.
  const [refreshed, setRefreshed] = useState<{ path: string; data: PortfolioResponse; at: string } | null>(null)
  const [refreshingIcons, setRefreshingIcons] = useState(false)
  const refresh = () => {
    findings.reload()
    setRefreshingIcons(true)
    const forPath = path
    const groupParam = group ? `&group=${encodeURIComponent(group)}` : ''
    void apiFetch<PortfolioResponse>(`${base}?refreshIcons=1${groupParam}`, { cache: 'no-store' })
      .then((res) => {
        if (res.ok && res.data) setRefreshed({ path: forPath, data: res.data, at: new Date().toISOString() })
        // The flagged read failed: the normal read still refreshes (and shows its error).
        else page.reload()
      })
      .catch(() => page.reload())
      .finally(() => setRefreshingIcons(false))
  }
  const freshWins = refreshed != null && refreshed.path === path && (page.lastFetchedAt == null || refreshed.at >= page.lastFetchedAt)
  const portfolio = freshWins ? refreshed.data : page.data
  const fetchedAt = freshWins ? refreshed.at : page.lastFetchedAt
  // The public demo stays out of the cards and every count ("All 10 apps need you").
  const { apps: ownCards, demo } = useMemo(() => splitPublicDemo(portfolio?.cards ?? []), [portfolio])
  const cards = useMemo(() => sortPortfolioCards(ownCards), [ownCards])
  // Names from the team's project list until the portfolio read lands, so the other tabs can draw first.
  const names = useMemo(
    () => new Map([...teamApps.map((a): [string, string] => [a.projectId, a.name]), ...(portfolio?.cards ?? []).map((c): [string, string] => [c.projectId, c.name])]),
    [teamApps, portfolio],
  )
  const openBugs = useMemo(() => cards.reduce((n, c) => n + c.openReports, 0), [cards])
  // App icons and SDK check-ins: the team's project list knows each app's SDK origin, repo and last call.
  const setup = useSetupStatus()
  const snapshots = useProjectSnapshots()
  const checkIns = useMemo(() => lastCheckIns(setup.data?.projects), [setup.data])
  // Ages are measured from when the server answered (also the CI column's "today"), so render stays pure.
  const now = portfolio ? Date.parse(portfolio.generatedAt) || 0 : 0
  // The ranking behind the headline, the alert cards and the heat grid (lib/appSignals).
  const ranked = useMemo(() => rankApps(cards, checkIns, now), [cards, checkIns, now])
  const status = useMemo(() => rankingSentence(ranked), [ranked])
  const firstReason = status.first?.reasons[0] ?? null
  const alerts = useMemo(() => appAlerts(ranked, openApp), [ranked])
  const [view, setViewState] = useState<PortfolioView>(readView)
  const setView = (next: PortfolioView) => {
    setViewState(next)
    writeView(next)
  }
  // Apps that need a look get a full card; the rest collapse to one row each.
  // The status sentence always names the worst app; the grid and cards follow the toggle.
  const sortBy: PortfolioSort = searchParams.get('sort') === 'name' ? 'name' : 'worst'
  const setSortBy = (next: PortfolioSort) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'name') params.set('sort', 'name')
    else params.delete('sort')
    setSearchParams(params, { replace: true })
  }
  const rankedShown = useMemo(() => (sortBy === 'worst' ? ranked : rankApps(cards, checkIns, now, 'name')), [sortBy, ranked, cards, checkIns, now])
  const shown = useMemo(() => rankedShown.map((r) => r.card), [rankedShown])
  const attention = useMemo(() => shown.filter(needsALook), [shown])
  const healthy = useMemo(() => shown.filter((c) => !needsALook(c)), [shown])
  // Every app, the demo included: spend, connectors and the digest still name it.
  // The team's project list stands in until the portfolio read lands.
  const appList = useMemo(() => (portfolio ? portfolio.cards.map((c) => ({ projectId: c.projectId, name: c.name })) : teamApps), [portfolio, teamApps])
  // Only a finished read that holds no app hides the tabs; while it runs, every tab but Apps draws.
  const knownEmpty = portfolio != null && cards.length === 0
  const faviconFor = useCallback(
    (card: PortfolioCard): ProjectFaviconSource => {
      const known = setup.data?.projects.find((p) => p.project_id === card.projectId)
      const base = known
        ? faviconSourceFromProject(known, snapshots.byId.get(card.projectId))
        : { project_id: card.projectId, project_name: card.name, project_slug: card.slug ?? '' }
      // The store icon from the portfolio read wins; the favicon and initials follow.
      return card.iconUrl ? { ...base, icon_url: card.iconUrl } : base
    },
    [setup.data, snapshots.byId],
  )
  // An app's icon by id, for the grouped rows and matrices on every tab.
  const cardById = useMemo(() => new Map((portfolio?.cards ?? []).map((c) => [c.projectId, c])), [portfolio])
  const iconFor = useCallback(
    (projectId: string): ProjectFaviconSource => {
      const c = cardById.get(projectId)
      return c ? faviconFor(c) : { project_id: projectId, project_name: names.get(projectId) ?? projectId.slice(0, 8), project_slug: '' }
    },
    [cardById, faviconFor, names],
  )
  const appOrder = useMemo(() => rankedShown.map((r) => r.card.projectId), [rankedShown])

  return (
    <HighlightProvider>
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-portfolio">
        <PageHeaderBar
          title="Apps"
          description="All your apps in one place: what is broken, out of date or behind, and what to fix once for all of them."
          helpTitle="About apps"
          helpWhatIsIt="The worst apps lead as red and amber cards, each with one thing to do. Below, one row per app: open bugs, risks, SDK, release age, CI failures today and the SDK's last check-in, darker where it is worse. Cards shows the same apps as cards. Under them, Fix once is a problems × apps grid: a dot where a problem is open, one button that copies the fix for all of them. Releases, Payments, Spend and accounts, and Digest are tabs."
          helpHowToUse="Start with the first alert card. Point at a row, card or alert to light the same app everywhere; click a row to pin it (Esc clears). A hatched cell means no data, never a pass. Copy a fix-once prompt into your editor to fix the same problem in every repo."
          helpFlowPath="/portfolio"
        >
          <FreshnessPill at={fetchedAt} isValidating={page.isValidating} />
          <Btn size="sm" variant="ghost" onClick={refresh} loading={page.isValidating || refreshingIcons} title="Read every app again, and look up their store icons again">
            Refresh
          </Btn>
        </PageHeaderBar>

        <PagePosture
          slots={[
            {
              priority: POSTURE_PRIORITY.heroOrSnapshot,
              show: cards.length > 0,
              children: portfolio ? (
                <PageStatus
                  sentence={status.sentence}
                  tone={status.tone}
                  ariaLabel="Apps status"
                  metrics={[
                    { label: 'Need you', value: cards.filter(needsALook).length, hint: 'Apps that are broken, have open bugs, or have a part to fix. SDK updates and Mushi Mushi setup chores do not count.' },
                    { label: 'Open bugs', value: openBugs, hint: 'Open bug reports across these apps.' },
                    { label: 'Fix once', value: portfolio.repeatedGroups, hint: 'Problems open in two or more apps, fixed with one prompt.' },
                  ]}
                  action={
                    status.first && firstReason ? (
                      <Btn size="sm" variant="primary" to={appLink(firstReason.to, status.first.card.projectId)} onClick={() => openApp(status.first!.card.projectId)}>
                        Fix {status.first.card.name}
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

        {portfolio && cards.length > 0 && (
          <AlertCards
            alerts={alerts}
            emptyText="No app needs you right now."
            label="Apps that need you"
            testIdPrefix="portfolio"
            keyLabel={(k) => names.get(k.replace(/^app:/, '')) ?? k}
          />
        )}

        {page.error && (
          <PageLoadError error={page.error} code={page.errorCode} resource="portfolio" endpoint={page.errorEndpoint} requestId={page.requestId} onRetry={page.reload} />
        )}
        {portfolio && portfolio.readErrors.length > 0 && <ReadErrorsCallout errors={portfolio.readErrors} />}
        {knownEmpty && (
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
        {knownEmpty && demo.length > 0 && <PublicDemoLine demo={demo} />}
        {!knownEmpty && (
          <>
            <TabbedSubNav
              ariaLabel="Apps sections"
              tabs={PORTFOLIO_TABS.map((t) => ({ to: tabHref(t.id), label: t.label, match: () => tab === t.id }))}
            />
            {tab === 'apps' && !portfolio && page.loading && (
              // The apps are known before their details: list them at once instead of
              // a bare spinner, which sat for 5 s on a first load (2026-10-28).
              <section aria-label="Apps" data-testid="portfolio-tab-apps">
                {teamApps.length > 0 ? (
                  <Card className="px-3 py-1">
                    <ul className="divide-y divide-edge-subtle text-xs" aria-busy="true" data-testid="portfolio-loading-apps">
                      {teamApps.map((app) => (
                        <li key={app.projectId} className="flex items-center justify-between gap-3 py-2">
                          <span className="font-medium text-fg">{app.name}</span>
                          <span className="text-2xs text-fg-faint">Checking…</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : (
                  <Loading text="Checking each app…" />
                )}
              </section>
            )}
            {tab === 'apps' && portfolio && (
              <section id="portfolio-apps" aria-label="Apps" className="space-y-3" data-testid="portfolio-tab-apps">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <SegmentedControl
                    value={view}
                    onChange={setView}
                    size="sm"
                    ariaLabel="Show the apps as"
                    options={[
                      { id: 'table', label: 'Table' },
                      { id: 'cards', label: 'Cards' },
                    ]}
                  />
                  <SegmentedControl
                    value={sortBy}
                    onChange={setSortBy}
                    size="sm"
                    ariaLabel="Order the apps"
                    options={[
                      { id: 'worst', label: 'Worst first' },
                      { id: 'name', label: 'A to Z' },
                    ]}
                  />
                </div>
                <PanelErrorBoundary label="Portfolio cards">
                  {view === 'table' && (
                    <Card className="px-2.5 py-2">
                      <AppSignalGrid rows={rankedShown} now={now} />
                    </Card>
                  )}
                  {view === 'cards' && attention.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {attention.map((card) => (
                        <PortfolioCardTile key={card.projectId} card={card} favicon={faviconFor(card)} showSpend={isAdvanced} />
                      ))}
                    </div>
                  )}
                  {view === 'cards' && healthy.length > 0 && (
                    <Card className="p-0">
                      <p className="border-b border-edge px-3 py-2 text-2xs font-semibold text-fg-secondary">
                        Nothing urgent ({healthy.length})
                      </p>
                      <ul className="divide-y divide-edge">
                        {healthy.map((card) => (
                          <PortfolioCompactRow key={card.projectId} card={card} favicon={faviconFor(card)} />
                        ))}
                      </ul>
                    </Card>
                  )}
                  {demo.length > 0 && <PublicDemoLine demo={demo} />}
                </PanelErrorBoundary>
                <PanelErrorBoundary label="Fix once">
                  <PortfolioFindings findings={findings} iconFor={iconFor} appOrder={appOrder} />
                </PanelErrorBoundary>
              </section>
            )}

            {tab === 'releases' && (
              <section id="portfolio-releases" aria-label="Releases" className="space-y-3" data-testid="portfolio-tab-releases">
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
            )}

            {tab === 'payments' && (
              <section id="portfolio-payments" aria-label="Payments" className="space-y-3" data-testid="portfolio-tab-payments">
                <PanelErrorBoundary label="Payments across apps">
                  <MonetizationCard orgId={orgId} iconFor={iconFor} />
                </PanelErrorBoundary>
              </section>
            )}

            {tab === 'spend' && (
              <section id="portfolio-spend" aria-label="Spend and accounts" className="space-y-3" data-testid="portfolio-tab-spend">
                <PanelErrorBoundary label="Spend per app">
                  <SpendLedgerCard orgId={orgId} projects={appList} iconFor={iconFor} />
                </PanelErrorBoundary>
                <PanelErrorBoundary label="Accounts and resilience">
                  <AccountsRegisterCard orgId={orgId} />
                </PanelErrorBoundary>
                <PanelErrorBoundary label="Shared resources">
                  <SharedResourcesCard orgId={orgId} iconFor={iconFor} />
                </PanelErrorBoundary>
                <div id="portfolio-connectors" className="scroll-mt-20">
                  <PanelErrorBoundary label="Connected sources">
                    <ConnectorsCard orgId={orgId} projects={appList} />
                  </PanelErrorBoundary>
                </div>
              </section>
            )}

            {tab === 'digest' && (
              <section id="portfolio-digest" aria-label="Digest" className="space-y-3" data-testid="portfolio-tab-digest">
                <PanelErrorBoundary label="Daily digest">
                  <DigestCard orgId={orgId} projects={appList} />
                </PanelErrorBoundary>
              </section>
            )}
          </>
        )}
      </div>
    </HighlightProvider>
  )
}

/** The public demo: one muted line, not a card that "needs you". */
function PublicDemoLine({ demo }: { demo: readonly PortfolioCard[] }) {
  return (
    <p className="px-1 text-2xs text-fg-muted" data-testid="portfolio-public-demo">
      {demo.length === 1 ? "Mushi Mushi's public demo" : `Mushi Mushi's public demos (${demo.length})`} (sample data) · powers the docs try-it page
    </p>
  )
}
