/**
 * FILE: apps/admin/src/pages/InboxPage.tsx
 * PURPOSE: Global Action Inbox — tab shell (Overview | Actions | Stages | Activity)
 *          with stats banner, KPI strip, and PDCA action cards from dashboard data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ErrorAlert,
  Btn,
  FreshnessPill,
  PageHelp,
  PageHeader,
  AgeChip,
  Section,
  StatCard,
  SegmentedControl,
  Badge,
  Card,
} from '../components/ui'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PageHero } from '../components/PageHero'
import { InboxStatusBanner, isInboxStatusBannerCritical } from '../components/inbox/InboxStatusBanner'
import { EMPTY_INBOX_STATS, type InboxStats, type InboxTabId } from '../components/inbox/types'
import type { PageAction } from '../components/PageActionBar'
import type { ActivityItem, DashboardData } from '../components/dashboard/types'
import { buildInboxCards, type InboxCard, type InboxCardGroup } from '../lib/actionInboxFromDashboard'
import { useInboxUx, resolveQuickInboxTab } from '../lib/inboxModeUx'
import {
  backlogDetail,
  backlogTooltip,
  clearDetail,
  clearTooltip,
  criticalDetail,
  criticalTooltip,
  openDetail,
  openTooltip,
} from '../lib/statTooltips/inbox'
import { inboxLinks, statLink } from '../lib/statCardLinks'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  MetaChip,
  SignalChip,
  InlineProof,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'

type Group = InboxCardGroup

const INBOX_TABS: Array<{ id: InboxTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, top priority, and how to read open vs clear stages.',
  },
  {
    id: 'actions',
    label: 'Actions',
    description: 'Priority worklist — every open card with a primary CTA, top to bottom.',
  },
  {
    id: 'stages',
    label: 'Stages',
    description: 'Filter by PDCA stage — open cards and cleared stage chips in one view.',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Recent reports and fixes that fed the inbox counts.',
  },
]

const GROUP_LABEL: Record<Group, string> = {
  plan: 'Plan',
  do: 'Do',
  check: 'Check',
  act: 'Act',
  ops: 'Ops',
}

const GROUP_LONG_LABEL: Record<Group, string> = {
  plan: 'Plan — classify + triage',
  do: 'Do — dispatch + land fixes',
  check: 'Check — verify quality',
  act: 'Act — connections + config',
  ops: 'Ops — health + compliance',
}

const GROUP_TONE: Record<Group, { chip: string; chipText: string; ring: string }> = {
  plan: { chip: 'bg-info-muted', chipText: 'text-info', ring: 'border-info/30' },
  do: { chip: 'bg-brand/15', chipText: 'text-brand', ring: 'border-brand/30' },
  check: { chip: 'bg-warn-muted', chipText: 'text-warn', ring: 'border-warn/30' },
  act: { chip: 'bg-ok-muted', chipText: 'text-ok', ring: 'border-ok/30' },
  ops: { chip: 'bg-surface-overlay', chipText: 'text-fg-muted', ring: 'border-edge' },
}

const TONE_RING: Record<PageAction['tone'], string> = {
  plan: 'border-info/40 bg-info-muted/15',
  do: 'border-brand/40 bg-brand/10',
  check: 'border-warn/40 bg-warn/10',
  act: 'border-ok/40 bg-ok-muted/15',
  idle: 'border-edge bg-surface-raised/40',
}

type FilterValue = 'all' | 'open' | 'clear' | Group

function isInboxTab(value: string | null): value is InboxTabId {
  return INBOX_TABS.some((t) => t.id === value)
}

export function InboxPage() {
  const copy = usePageCopy('/inbox')
  const ux = useInboxUx()
  const activeProjectId = useActiveProjectId()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: InboxTabId = isInboxTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = INBOX_TABS.find((t) => t.id === activeTab) ?? INBOX_TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<InboxStats>('/v1/admin/inbox/stats')
  const stats = statsData ?? EMPTY_INBOX_STATS

  const { data, loading, error, isValidating, lastFetchedAt, reload } =
    usePageData<DashboardData>('/v1/admin/dashboard')
  const cards = useMemo(() => buildInboxCards(data ?? undefined), [data])
  const [filter, setFilter] = useState<FilterValue>('all')

  const reloadAll = useCallback(() => {
    reloadStats()
    reload()
  }, [reloadStats, reload])

  useRealtimeReload(['reports', 'fix_attempts', 'fix_events', 'integration_health_history'], reloadAll, {
    debounceMs: 1000,
    enabled: stats.hasAnyProject,
  })

  const setActiveTab = useCallback(
    (id: InboxTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickInboxTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats.openActions, activeTab, setActiveTab, stats])

  const openCards = cards.filter((c) => c.action !== null)
  const clearCards = cards.filter((c) => c.action === null)

  const visibleOpen =
    filter === 'clear'
      ? []
      : filter === 'open' || filter === 'all'
        ? openCards
        : openCards.filter((c) => c.group === filter)
  const visibleClear =
    filter === 'open'
      ? []
      : filter === 'clear' || filter === 'all'
        ? clearCards
        : clearCards.filter((c) => c.group === filter)

  const activity = data?.activity ?? []
  const activityAtByGroup = useMemo(() => {
    const map: Partial<Record<Group, string>> = {}
    for (const item of activity) {
      if (item.kind === 'report' && !map.plan) map.plan = item.at
      if (item.kind === 'fix' && !map.do) map.do = item.at
    }
    return map
  }, [activity])

  const pdcaGroups: Group[] = ['plan', 'do', 'check', 'act', 'ops']

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : !stats.setupDone
        ? 'warn'
        : stats.openActions > 0
          ? 'danger'
          : 'ok'

  usePublishPageContext({
    route: '/inbox',
    title: 'Action inbox',
    summary: `${activeTabMeta.label} · ${stats.openActions > 0 ? `${stats.openActions} open action${stats.openActions === 1 ? '' : 's'}` : 'All clear'}`,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.openActions,
    questions:
      stats.openActions > 0
        ? [
            'Which action should I tackle first?',
            'Why is the highest-severity card blocking?',
            'Group these by PDCA stage and tell me where the loop is stuck.',
          ]
        : [
            'Is there anything that should be on this inbox but isn\u2019t?',
            'What changed in the last 24h to clear the inbox?',
          ],
    actions: [{ id: 'inbox-refresh', label: 'Refresh', hint: 'Re-fetch stats + dashboard', run: reloadAll }],
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'actions' as const,
        label: copy?.tabLabels?.actions ?? 'Actions',
        count: stats.openActions > 0 ? stats.openActions : undefined,
      },
      {
        id: 'stages' as const,
        label: copy?.tabLabels?.stages ?? 'Stages',
        count: stats.clearStages > 0 ? stats.clearStages : undefined,
      },
      { id: 'activity' as const, label: copy?.tabLabels?.activity ?? 'Activity' },
    ],
    [stats, copy?.tabLabels],
  )

  if ((loading && !data) || (statsLoading && !statsData)) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden="true" role="status" aria-label="Loading inbox">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised/40" />
          ))}
        </div>
      </div>
    )
  }
  if (error) return <ErrorAlert message={error} onRetry={reloadAll} />
  if (statsError) return <ErrorAlert message={`Failed to load inbox stats: ${statsError}`} onRetry={reloadAll} />

  return (
    <div data-inbox-root className="space-y-4">
      <PageHelp
        title={copy?.help?.title ?? 'About the inbox'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'A single view that surfaces every action waiting for you — bugs to triage, fixes to review, and connections to set up.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Start every morning on Overview — read the banner, then switch to Actions',
            'Use Stages tab to filter by Plan / Do / Check / Act / Ops',
            'Activity tab shows the events that triggered open cards',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Red banner = open work. Green banner = inbox zero. Every card has a primary CTA — no dead buttons.'
        }
      />

      <PageHeader
        title={copy?.title ?? 'Action inbox'}
        projectScope={stats.projectName ?? undefined}
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'danger'
                ? 'bg-danger/10 text-danger'
                : bannerSeverity === 'warn'
                  ? 'bg-warn/10 text-warn'
                  : 'bg-info/10 text-info'
          }
        >
          {bannerSeverity === 'ok'
            ? 'CLEAR'
            : bannerSeverity === 'danger'
              ? `${stats.openActions} OPEN`
              : bannerSeverity === 'warn'
                ? 'SETUP'
                : 'START'}
        </Badge>
        <FreshnessPill
          at={statsFetchedAt ?? lastFetchedAt}
          isValidating={statsValidating || isValidating}
        />
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || isValidating}>
          Refresh
        </Btn>
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            (stats.openActions > 0
              ? `${stats.openActions} open action${stats.openActions === 1 ? '' : 's'} — work top to bottom on Actions tab`
              : 'No open actions — cleared stages stay one click away on Stages tab')}
        </p>
      </ContainedBlock>

      {isInboxStatusBannerCritical(stats) && (
        <InboxStatusBanner
          stats={stats}
          onTab={setActiveTab}
          onRefresh={reloadAll}
          refreshing={statsValidating || isValidating}
          plainBanner={ux.plainBanner}
        />
      )}

      {!ux.hideTabs && (
        <SegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          options={tabOptions}
          ariaLabel="Inbox sections"
          size="sm"
        />
      )}

      {activeTab === 'overview' && (
        <>
          {!ux.hideOverviewChrome && (
          <PageHero
            scope="inbox"
            title="Action inbox"
            kicker="Start here"
            decide={{
              label:
                stats.openActions > 0
                  ? (stats.topPriorityTitle ?? 'Open actions waiting')
                  : 'All clear',
              metric: stats.openActions > 0 ? `${stats.openActions} open` : `${stats.clearStages}/${stats.totalSurfaces} clear`,
              summary:
                stats.openActions > 0
                  ? 'Work the Actions tab top-to-bottom — each card links to the page where you can resolve it.'
                  : 'New reports and integration drift surface here automatically — green banner means nothing is blocking.',
              severity: bannerSeverity === 'ok' ? 'ok' : bannerSeverity === 'danger' ? 'crit' : 'info',
            }}
            verify={{
              label: 'Live counts',
              detail: 'Cards derive from the same dashboard aggregate as the sidebar badge.',
            }}
          />
          )}

          {!ux.hideOverviewChrome && stats.topPriorityTitle && stats.topPriorityTo && stats.openActions > 0 ? (
            <Card className="border-danger/30 bg-danger/5 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <SignalChip tone="danger">Top priority</SignalChip>
                {stats.topPriorityStage ? (
                  <SignalChip tone="info">
                    {GROUP_LABEL[stats.topPriorityStage as Group] ?? stats.topPriorityStage} stage
                  </SignalChip>
                ) : (
                  <SignalChip tone="neutral">Highest-severity open action</SignalChip>
                )}
              </div>
              <ContainedBlock tone="warn" label="Next action">
                <p className="text-sm font-medium leading-snug text-fg">{stats.topPriorityTitle}</p>
              </ContainedBlock>
              <ActionPillRow className="mt-3">
                <ActionPill to={stats.topPriorityTo} tone="brand">
                  {copy?.actionLabels?.takeAction ?? 'Take action'} →
                </ActionPill>
                <ActionPill tone="neutral" onClick={() => setActiveTab('actions')}>
                  {copy?.actionLabels?.queue ?? 'View full queue'}
                </ActionPill>
              </ActionPillRow>
            </Card>
          ) : null}

          {openCards.length === 0 && clearCards.length > 0 ? (
            <section aria-label="Cleared stages preview">
              <header className="mb-2">
                <h2 className="text-sm font-semibold text-fg-secondary">All stages clear</h2>
              </header>
              <ul className="flex flex-wrap gap-1.5">
                {clearCards.map((card) => (
                  <li key={card.id}>
                    <ClearChip card={card} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {!ux.hideInboxSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'INBOX SNAPSHOT'} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeTabMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.open ?? 'Open'}
            value={stats.openActions}
            accent={stats.openActions > 0 ? 'text-danger' : 'text-ok'}
            tooltip={openTooltip(stats)}
            detail={openDetail(stats)}
            to={statLink(inboxLinks.open, stats)}
          />
          <StatCard
            label={copy?.statLabels?.clear ?? 'Clear'}
            value={stats.clearStages}
            accent="text-ok"
            tooltip={clearTooltip(stats, ux.plainStageLabels)}
            detail={clearDetail(stats, ux.plainStageLabels)}
            to={inboxLinks.clear}
          />
          <StatCard
            label={copy?.statLabels?.backlog ?? 'Backlog'}
            value={stats.openBacklog}
            accent={stats.openBacklog > 0 ? 'text-warn' : undefined}
            tooltip={backlogTooltip(stats)}
            detail={backlogDetail(stats)}
            to={inboxLinks.backlog}
          />
          <StatCard
            label={copy?.statLabels?.critical ?? 'Critical 14d'}
            value={stats.criticalReports14d}
            accent={stats.criticalReports14d > 0 ? 'text-brand' : undefined}
            tooltip={criticalTooltip(stats)}
            detail={criticalDetail(stats)}
            to={inboxLinks.critical}
          />
        </div>
      </Section>
      )}

      {activeTab === 'actions' && (
        <>
          {visibleOpen.length > 0 ? (
            <section aria-labelledby="inbox-open">
              <header className="mb-2 flex items-center gap-2">
                <h2 id="inbox-open" className="text-sm font-semibold text-fg">
                  Awaiting action
                </h2>
                <SignalChip tone="neutral" className="tabular-nums">
                  {visibleOpen.length} card{visibleOpen.length === 1 ? '' : 's'}
                </SignalChip>
                {visibleOpen.length > 1 ? (
                  <InlineProof className="ml-auto border-0 bg-transparent px-0 py-0">
                    Work top-to-bottom
                  </InlineProof>
                ) : null}
              </header>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {visibleOpen.map((card, index) => (
                  <OpenInboxCard
                    key={card.id}
                    card={card}
                    priority={index + 1}
                    isFirst={index === 0}
                    activityAt={activityAtByGroup[card.group]}
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="space-y-3">
              <EmptySectionMessage
                text="Inbox zero"
                hint="No open actions — switch to Stages to confirm cleared surfaces or Activity for recent events."
              />
              <ActionPillRow>
                <ActionPill tone="neutral" onClick={() => setActiveTab('stages')}>
                  View stages
                </ActionPill>
              </ActionPillRow>
            </div>
          )}
        </>
      )}

      {activeTab === 'stages' && (
        <>
          <div role="toolbar" aria-label="Filter inbox" className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={cards.length}>
              All
            </FilterChip>
            <FilterChip
              active={filter === 'open'}
              onClick={() => setFilter('open')}
              count={openCards.length}
              tone={openCards.length > 0 ? 'do' : 'idle'}
            >
              Open
            </FilterChip>
            <FilterChip active={filter === 'clear'} onClick={() => setFilter('clear')} count={clearCards.length} tone="act">
              Clear
            </FilterChip>
            <span aria-hidden className="mx-1 text-fg-faint">
              ·
            </span>
            {pdcaGroups.map((g) => {
              const groupOpen = openCards.filter((c) => c.group === g).length
              const groupTotal = cards.filter((c) => c.group === g).length
              if (groupTotal === 0) return null
              return (
                <FilterChip
                  key={g}
                  active={filter === g}
                  onClick={() => setFilter(g)}
                  count={groupTotal}
                  tone={groupOpen > 0 ? 'do' : 'idle'}
                >
                  {GROUP_LABEL[g]}
                </FilterChip>
              )
            })}
          </div>

          {visibleOpen.length > 0 ? (
            <section aria-labelledby="inbox-stages-open" className="mb-6">
              <header className="mb-2">
                <h2 id="inbox-stages-open" className="text-sm font-semibold text-fg">
                  Open in filter
                </h2>
              </header>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {visibleOpen.map((card, index) => (
                  <OpenInboxCard
                    key={card.id}
                    card={card}
                    priority={index + 1}
                    activityAt={activityAtByGroup[card.group]}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {visibleClear.length > 0 ? (
            <section aria-labelledby="inbox-clear">
              <header className="mb-2 flex items-center gap-2">
                <h2 id="inbox-clear" className="text-sm font-semibold text-fg-secondary">
                  Clear stages
                </h2>
                <SignalChip tone="ok" className="tabular-nums">
                  {visibleClear.length} settled
                </SignalChip>
              </header>
              <ul className="flex flex-wrap gap-1.5">
                {visibleClear.map((card) => (
                  <li key={card.id}>
                    <ClearChip card={card} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {visibleOpen.length === 0 && visibleClear.length === 0 ? (
            <div className="space-y-3">
              <EmptySectionMessage
                text={filter === 'all' ? 'All clear' : 'Nothing here'}
                hint={
                  filter === 'all'
                    ? 'The loop is clear — new reports will appear here automatically.'
                    : `No ${filter === 'open' ? 'open' : filter === 'clear' ? 'cleared' : GROUP_LONG_LABEL[filter as Group]} cards right now.`
                }
              />
              {filter !== 'all' ? (
                <ActionPillRow>
                  <ActionPill tone="brand" onClick={() => setFilter('all')}>
                    Show all →
                  </ActionPill>
                </ActionPillRow>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {activeTab === 'activity' && (
        <>
          {activity.length > 0 ? (
            <section aria-labelledby="inbox-activity">
              <header className="mb-2 flex items-center gap-2">
                <h2 id="inbox-activity" className="text-sm font-semibold text-fg-secondary">
                  Recent activity
                </h2>
                <SignalChip tone="neutral" className="tabular-nums">
                  Last {activity.length} events
                </SignalChip>
              </header>
              <ul className="divide-y divide-edge-subtle/60 rounded-md border border-edge-subtle bg-surface-raised/30">
                {activity.map((item) => (
                  <ActivityFeedRow key={`${item.kind}-${item.id}`} item={item} />
                ))}
              </ul>
            </section>
          ) : (
            <div className="space-y-3">
              <EmptySectionMessage
                text="No recent activity"
                hint={`Reports and fix dispatches appear here once ingest is live on ${stats.projectName ?? 'your project'}.`}
              />
              <ActionPillRow>
                <ActionPill to="/onboarding?tab=verify" tone="brand">
                  Send test report
                </ActionPill>
              </ActionPillRow>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FilterChip({
  children,
  active,
  onClick,
  count,
  tone = 'idle',
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  count?: number
  tone?: PageAction['tone']
}) {
  const groupTone = tone === 'do' ? 'text-brand' : tone === 'act' ? 'text-ok' : 'text-fg-muted'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-2xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
        active
          ? 'border-brand/40 bg-brand/15 text-brand'
          : 'border-edge-subtle bg-surface-raised/40 text-fg-muted hover:bg-surface-overlay hover:text-fg'
      }`}
    >
      <span>{children}</span>
      {typeof count === 'number' ? (
        <span className={`tabular-nums ${active ? 'text-brand' : groupTone}`}>{count}</span>
      ) : null}
    </button>
  )
}

function ClearChip({ card }: { card: InboxCard }) {
  const groupTone = GROUP_TONE[card.group]
  return (
    <Link
      data-inbox-card={card.id}
      data-inbox-state="clear"
      to={card.pageTo}
      className="group inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/40 px-2 py-1 text-2xs font-medium text-fg-muted hover:border-ok/30 hover:bg-ok-muted/15 hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      title={`${card.pageLabel} — all clear. Click to open.`}
    >
      <SignalChip tone="ok">✓</SignalChip>
      <span
        className={`rounded-sm px-1 py-0.5 text-3xs font-semibold uppercase tracking-wider ${groupTone.chip} ${groupTone.chipText}`}
      >
        {GROUP_LABEL[card.group]}
      </span>
      <span className="text-fg-secondary group-hover:text-fg">{card.pageLabel}</span>
    </Link>
  )
}

function ActivityFeedRow({ item }: { item: ActivityItem }) {
  const to = item.kind === 'report' ? `/reports/${item.id}` : `/fixes`
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-overlay/60 motion-safe:transition-colors"
      >
        <SignalChip tone={item.kind === 'report' ? 'info' : 'brand'}>{item.kind}</SignalChip>
        <ContainedBlock tone="neutral" className="min-w-0 flex-1 px-2 py-1">
          <span className="block truncate text-fg-secondary">{item.label}</span>
        </ContainedBlock>
        {item.meta ? (
          <MetaChip label="Meta">{item.meta}</MetaChip>
        ) : null}
        <AgeChip at={item.at} />
      </Link>
    </li>
  )
}

function OpenInboxCard({
  card,
  priority,
  isFirst,
  activityAt,
}: {
  card: InboxCard
  priority: number
  isFirst?: boolean
  activityAt?: string
}) {
  const action = card.action
  if (!action) return null
  const groupTone = GROUP_TONE[card.group]
  return (
    <article
      data-inbox-card={card.id}
      data-inbox-state="open"
      className={`rounded-lg border p-4 ${TONE_RING[action.tone]}${isFirst ? ' md:col-span-2' : ''}`}
    >
      <header className="mb-2 flex flex-wrap items-center gap-1.5">
        <SignalChip tone="neutral">#{priority}</SignalChip>
        <span
          className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider ${groupTone.chip} ${groupTone.chipText}`}
        >
          {GROUP_LABEL[card.group]}
        </span>
        <MetaChip label="Page">{card.pageLabel}</MetaChip>
        {isFirst && !activityAt ? (
          <SignalChip tone="brand">Start here ↑</SignalChip>
        ) : null}
        {activityAt ? <AgeChip at={activityAt} title="Last activity in this stage" /> : null}
      </header>
      <ContainedBlock tone="info" label="Action">
        <p className="text-sm font-medium leading-snug text-fg">{action.title}</p>
      </ContainedBlock>
      {action.reason ? (
        <ContainedBlock tone="muted" className="mt-2">
          <p className="text-xs leading-snug text-fg-muted">{action.reason}</p>
        </ContainedBlock>
      ) : null}
      <ActionPillRow className="mt-3">
        {action.primary && action.primary.kind === 'link' ? (
          <ActionPill to={action.primary.to} tone="brand" className="px-3 py-1.5 text-xs">
            {action.primary.label} →
          </ActionPill>
        ) : null}
        {action.primary && action.primary.kind === 'button' ? (
          <Btn size="sm" variant="primary" onClick={action.primary.onClick} data-inbox-primary>
            {action.primary.label}
          </Btn>
        ) : null}
        {action.secondary?.slice(0, 1).map((s, i) =>
          s.kind === 'link' ? (
            <ActionPill key={i} to={s.to} tone="neutral">
              {s.label}
            </ActionPill>
          ) : null,
        )}
      </ActionPillRow>
    </article>
  )
}
