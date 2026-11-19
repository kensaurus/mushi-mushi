/**
 * FILE: apps/admin/src/pages/InboxPage.tsx
 * PURPOSE: Global Action Inbox — tab shell (Overview | Stages | Activity). Overview
 *          is the ordered action list, under one status banner.
 */

import { useCallback, useMemo, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useSearchParams } from 'react-router-dom'
import {
  FreshnessPill,
  AgeChip,
  SegmentedControl,
  FilterChip,
  type FilterChipTone, } from '../components/ui'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { reportDetailPath } from '../lib/reportUrl'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { InboxStatusBanner, inboxBannerRepeatsCards, isInboxStatusBannerCritical, reconcileInboxStats } from '../components/inbox/InboxStatusBanner'
import { InboxPdcaGuide } from '../components/inbox/InboxPdcaGuide'
import { InboxOverviewBody } from '../components/inbox/InboxOverviewBody'
import {
  ClearChip,
  GROUP_LABEL,
  GROUP_LONG_LABEL,
  OpenInboxCard,
} from '../components/inbox/inbox-card-parts'
import { EMPTY_INBOX_STATS, type InboxStats, type InboxTabId } from '../components/inbox/types'
import type { ActivityItem, DashboardData } from '../components/dashboard/types'
import { buildInboxCards, inboxCardCounts, type InboxCardGroup } from '../lib/actionInboxFromDashboard'
import { useInboxUx, resolveQuickInboxTab } from '../lib/inboxModeUx'
import { useQuickstartLandingTab } from '../lib/useQuickstartTab'
import {
  ActionPill,
  ActionPillRow,
  MetaChip,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import { PageLoadError } from '../components/PageLoadError'
import type { PipelineData } from '../lib/pipeline'
import { needsYouGroups } from '../lib/pipelineSignals'
import { LANES_PATH, type WorkLanesData } from '../lib/workers'
import { StatusGlyph, type SignalTone } from '../components/signal/StatusGlyph'

type Group = InboxCardGroup

const INBOX_TABS: Array<{ id: InboxTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Priority worklist — every open card with a primary CTA, top to bottom.',
  },
  {
    id: 'stages',
    label: 'Stages',
    description: 'Filter by step (bugs, fixes, checks, shipping): open cards and cleared ones in one view.',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Recent reports and fixes that fed the inbox counts.',
  },
]

type FilterValue = 'all' | 'open' | 'clear' | 'unchecked' | Group

const INBOX_FILTER_TONE: Record<'do' | 'act' | 'idle', FilterChipTone> = {
  do: 'brand',
  act: 'ok',
  idle: 'default',
}

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
  const serverStats = statsData ?? EMPTY_INBOX_STATS

  const { data, loading, error, isValidating, lastFetchedAt, reload } =
    usePageData<DashboardData>('/v1/admin/dashboard')
  // The same stuck pipeline groups Home's "Needs you" lists, and the local worker problems the
  // Pipeline page shows: Home said "2 reports: triaged over 3 days ago" and Pipeline had two
  // worker problems while this page listed one card and ticked "Integration health"
  // (round-2 review, 2026-11-18).
  const pipeline = usePageData<PipelineData>(activeProjectId ? `/v1/admin/pipeline?projectId=${encodeURIComponent(activeProjectId)}` : null, { scope: 'project' })
  // The same request Pipeline > This app reads for "Workers (N problems)", so the two pages count
  // worker problems from one response (round-3 review, 2026-11-19).
  const lanes = usePageData<WorkLanesData>(
    activeProjectId ? `${LANES_PATH}?projectId=${encodeURIComponent(activeProjectId)}` : LANES_PATH,
    { scope: activeProjectId ? 'project' : 'enumeration' },
  )
  const pipelineNeedsYou = useMemo(() => {
    if (!activeProjectId) return undefined
    const stages = pipeline.data?.stages
    if (!Array.isArray(stages)) return null
    return needsYouGroups(stages).map((g) => ({ id: g.id, label: g.label, count: g.count }))
  }, [activeProjectId, pipeline.data])
  const workerProblems = useMemo(() => {
    const flags = lanes.data?.flags
    if (!lanes.data) return null
    return (Array.isArray(flags) ? flags : []).length
  }, [lanes.data])
  const cards = useMemo(
    () =>
      buildInboxCards(data ?? undefined, {
        judgeStale: serverStats.judgeStale,
        judgeStaleHours: serverStats.judgeStaleHours,
        // Only once stats have loaded; the empty defaults would tick every card.
        ...(statsData
          ? {
              urgentOpenReports: serverStats.urgentOpenReports,
              integrationRed: serverStats.integrationRed,
              integrationAmber: serverStats.integrationAmber,
            }
          : {}),
        pipelineNeedsYou,
        workerProblems,
      }),
    [data, statsData, serverStats.judgeStale, serverStats.judgeStaleHours, serverStats.urgentOpenReports, serverStats.integrationRed, serverStats.integrationAmber, pipelineNeedsYou, workerProblems],
  )
  // One count for the banner, the Stages badge and the filter chips: the cards themselves.
  const counts = useMemo(() => inboxCardCounts(cards), [cards])
  const stats = useMemo(() => reconcileInboxStats(serverStats, counts), [serverStats, counts])
  const [filter, setFilter] = useState<FilterValue>('all')

  const reloadPipeline = pipeline.reload
  const reloadAll = useCallback(() => {
    reloadStats()
    reload()
    reloadPipeline()
  }, [reloadStats, reload, reloadPipeline])

  // Not integration_health_history: probes write it about 150 times an hour
  // across the projects a user can see, which reloaded both of this page's
  // heaviest reads about every 24 s while it sat open (measured 2026-10-16).
  // The health badge comes from nav-meta, which does not watch that table.
  useRealtimeReload(['reports', 'fix_attempts', 'fix_events'], reloadAll, {
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

  // Quick mode opens the posture tab once; links and clicks then win.
  useQuickstartLandingTab({
    enabled: ux.isQuickstart,
    ready: !statsLoading,
    tabParam: tabParam,
    activeTab: activeTab,
    quickTab: resolveQuickInboxTab(activeTab),
    setActiveTab: setActiveTab,
  })

  const openCards = cards.filter((c) => c.action !== null)
  const clearCards = cards.filter((c) => c.action === null)

  const visibleOpen =
    filter === 'clear' || filter === 'unchecked'
      ? []
      : filter === 'open' || filter === 'all'
        ? openCards
        : openCards.filter((c) => c.group === filter)
  // Clear lists only checked-and-passing cards; nothing-yet and not-checked ones have their own chip.
  const visibleClear =
    filter === 'open'
      ? []
      : filter === 'clear'
        ? clearCards.filter((c) => c.state === 'pass')
        : filter === 'unchecked'
          ? clearCards.filter((c) => c.state !== 'pass')
          : filter === 'all'
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

  usePublishPageContext({
    route: '/inbox',
    title: copy?.title ?? 'To-do',
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

  const openStages = counts.open

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'stages' as const,
        label: copy?.tabLabels?.stages ?? 'Stages',
        count: openStages > 0 ? openStages : undefined,
      },
      { id: 'activity' as const, label: copy?.tabLabels?.activity ?? 'Activity' },
    ],
    [copy?.tabLabels, openStages],
  )

  if ((loading && !data) || (statsLoading && !statsData)) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden="true" role="status" aria-label="Loading inbox">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised" />
          ))}
        </div>
      </div>
    )
  }
  if (error) return <PageLoadError error={error} resource="the inbox" onRetry={reloadAll} />
  if (statsError) return <PageLoadError error={statsError} resource="the inbox counts" onRetry={reloadAll} />

  return (
    <div data-inbox-root className={PAGE_CONTENT_STACK} data-testid="mushi-page-inbox">
      <PageHeaderBar
        title={copy?.title ?? 'To-do'}
        projectScope={stats.projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About the to-do list'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Your cross-loop action worklist — not the same as the Reports page. Reports lists end-user bugs. The Inbox tells you what to do about them, and aggregates all other actions across triage, failed fixes, integration health, and ops into one priority-ordered list.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Start every morning on Overview — read the banner, then work the list top to bottom',
            'Use Stages tab to filter by Plan / Do / Check / Act / Ops',
            'Activity tab shows the events that triggered open cards',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Amber banner = open work. Green banner = inbox zero. Every card has a primary CTA — no dead buttons.'
        }
      >
        <FreshnessPill
          at={statsFetchedAt ?? lastFetchedAt}
          isValidating={statsValidating || isValidating}
        />
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            // One open card: the card is the banner (sweep 2026-11-18).
            show: isInboxStatusBannerCritical(stats) && !inboxBannerRepeatsCards(stats, openCards.length),
            children: (
              <InboxStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={statsValidating || isValidating}
                plainBanner={ux.plainBanner}
                cardsShown={activeTab !== 'activity'}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: !isInboxStatusBannerCritical(stats),
            children: <InboxPdcaGuide stats={stats} />,
          },
        ]}
      />

      {!ux.hideTabs && (
        <SegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          options={tabOptions}
          ariaLabel="Inbox sections"
          size="sm"
          // Its own width, not a full-width bordered strip holding three tabs (2026-11-18).
          className="self-start"
        />
      )}

      {activeTab === 'overview' && (
        <InboxOverviewBody
          stats={stats}
          openCards={openCards}
          clearCards={clearCards}
          onTab={setActiveTab}
          copy={copy ?? undefined}
          activityAtByGroup={activityAtByGroup}
        />
      )}

      {activeTab === 'stages' && (
        <>
          <div role="toolbar" aria-label="Filter inbox" className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              label="All"
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              count={counts.total}
            />
            <FilterChip
              label="Open"
              active={filter === 'open'}
              onClick={() => setFilter('open')}
              count={counts.open}
              tone={INBOX_FILTER_TONE[counts.open > 0 ? 'do' : 'idle']}
            />
            <FilterChip
              label="Clear"
              active={filter === 'clear'}
              onClick={() => setFilter('clear')}
              count={counts.settled}
              tone={INBOX_FILTER_TONE.act}
            />
            {/* All = Open + Clear + this: the sixth card was in no chip (round-3 review, 2026-11-19). */}
            {counts.unchecked > 0 ? (
              <FilterChip
                label="Not checked"
                active={filter === 'unchecked'}
                onClick={() => setFilter('unchecked')}
                count={counts.unchecked}
                tone={INBOX_FILTER_TONE.idle}
              />
            ) : null}
            <span aria-hidden className="mx-1 text-fg-faint">
              ·
            </span>
            {pdcaGroups.map((g) => {
              const groupOpen = openCards.filter((c) => c.group === g).length
              const groupTotal = cards.filter((c) => c.group === g).length
              if (groupTotal === 0) return null
              // The open count only: a "1" on every stage chip counted cards, not work (2026-11-18).
              return (
                <FilterChip
                  key={g}
                  label={GROUP_LABEL[g]}
                  active={filter === g}
                  onClick={() => setFilter(g)}
                  count={groupOpen > 0 ? groupOpen : undefined}
                  tone={INBOX_FILTER_TONE[groupOpen > 0 ? 'do' : 'idle']}
                />
              )
            })}
          </div>

          {visibleOpen.length > 0 ? (
            <section aria-labelledby="inbox-stages-open" className="mb-6">
              <header className="mb-2">
                <h2 id="inbox-stages-open" className="text-sm font-semibold text-fg">
                  Open
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
              {/* The Clear chip above holds the count; a "2 settled" chip here said it again. */}
              <header className="mb-2">
                <h2 id="inbox-clear" className="text-sm font-semibold text-fg-secondary">
                  Nothing to do
                </h2>
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
                    : `No ${filter === 'open' ? 'open' : filter === 'clear' ? 'cleared' : filter === 'unchecked' ? 'unchecked' : GROUP_LONG_LABEL[filter as Group]} cards right now.`
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
          {/* Quick mode hides the tab bar, so the Activity view (opened from
              "View activity") needs its own way back. */}
          {ux.hideTabs ? (
            <ActionPillRow>
              <ActionPill tone="neutral" onClick={() => setActiveTab('overview')}>
                ← Back to inbox
              </ActionPill>
            </ActionPillRow>
          ) : null}
          {activity.length > 0 ? (
            <section aria-labelledby="inbox-activity">
              <header className="mb-2 flex items-center gap-2">
                <h2 id="inbox-activity" className="text-sm font-semibold text-fg-secondary">
                  Recent activity
                </h2>
              </header>
              <ul className="divide-y divide-edge-subtle/60 rounded-md border border-edge-subtle bg-surface-raised">
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

const SEVERITY_WORDS: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low'])

/**
 * What an activity row's meta is: the server sends a report's severity (or its category or
 * status) and a fix's model or agent. "Meta:" explained nothing (round-2 review, 2026-11-18).
 */
export function activityMetaLabel(item: Pick<ActivityItem, 'kind' | 'meta'>): string | null {
  if (!item.meta) return null
  if (item.kind === 'fix') return 'Agent'
  return SEVERITY_WORDS.has(item.meta.toLowerCase()) ? 'Severity' : 'Status'
}

const SEVERITY_TONE: Record<string, SignalTone> = { critical: 'danger', high: 'warn', medium: 'info', low: 'off' }

/**
 * Raw float noise in a report title ("15.341893476 GB") reads as a bug of its own: round any
 * number with more than two decimals to one (round-3 review, 2026-11-19).
 * @internal Exported for tests.
 */
export function tidyActivityLabel(label: string): string {
  return label.replace(/\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 10) / 10))
}

function ActivityFeedRow({ item }: { item: ActivityItem }) {
  const activeProjectId = useActiveProjectId()
  const to = item.kind === 'report' ? reportDetailPath(item.id, activeProjectId) : `/fixes`
  const metaLabel = activityMetaLabel(item)
  const severityTone = metaLabel === 'Severity' && item.meta ? SEVERITY_TONE[item.meta.toLowerCase()] : undefined
  return (
    <li>
      {/* The title wraps (three lines at most) instead of cutting mid-word at 390 px; a report row
          needs no "report" chip, only a fix row says what it is. A severity is a mark, not
          "Severity: medium" written out on every row (round-3 review, 2026-11-19). */}
      <Link
        to={to}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-xs hover:bg-surface-overlay motion-safe:transition-opacity"
      >
        {severityTone ? (
          <span className="self-center" title={`Severity: ${item.meta}`}>
            <StatusGlyph tone={severityTone} label={`Severity: ${item.meta}`} />
          </span>
        ) : null}
        {item.kind === 'fix' ? <SignalChip tone="neutral">fix</SignalChip> : null}
        <span className="min-w-0 flex-1 basis-48 line-clamp-3 wrap-break-word text-fg-secondary">{tidyActivityLabel(item.label)}</span>
        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {item.meta && metaLabel && !severityTone ? <MetaChip label={metaLabel}>{item.meta}</MetaChip> : null}
          <AgeChip at={item.at} />
        </span>
      </Link>
    </li>
  )
}
