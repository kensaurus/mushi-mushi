/**
 * FILE: apps/admin/src/pages/NotificationsPage.tsx
 * PURPOSE: Reporter notification inbox — outbound messages the SDK widget polls.
 */

import { useCallback, useMemo, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRealtimeReload } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { tabbedPageTitle } from '../lib/pageTitle'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { useNotificationsUx, resolveQuickNotificationsTab } from '../lib/notificationsModeUx'
import { useQuickstartLandingTab } from '../lib/useQuickstartTab'
import { ReporterNotificationsToggle } from '../components/notifications/ReporterNotificationsToggle'
import {
  Section,
  Badge,
  Btn,
  EmptyState,
  FilterSelect,
  LogBlock,
  RelativeTime,
  SegmentedControl,
  FreshnessPill,
} from '../components/ui'
import { ActionPill } from '../components/report-detail/ReportSurface'
import { StatusPill } from '../components/signal/StatusMark'
import { reporterLabel, reporterSetupChecks, sentRowTitle } from '../lib/notificationsView'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { NextStep } from '../components/NextStep'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'
import { ConfigHelp } from '../components/ConfigHelp'
import { NotificationsStatusBanner } from '../components/notifications/NotificationsStatusBanner'
import { NotificationsSnapshotStrip } from '../components/notifications/NotificationsSnapshotStrip'
import { ReporterUpdateFunnel } from '../components/notifications/ReporterUpdateFunnel'
import { NotificationsReadout } from '../components/notifications/NotificationsReadout'
import { ReporterOutboxPanel } from '../components/notifications/ReporterOutboxPanel'
import { ReporterChannelsCard } from '../components/notifications/ReporterChannelsCard'
import {
  EMPTY_NOTIFICATIONS_STATS,
  TYPE_BADGE,
  TYPE_OPTIONS,
  type NotificationStats,
  type NotificationTabId,
  type ReporterNotification,
} from '../components/notifications/types'
import { CHIP_TONE } from '../lib/chipTone'
import { PageLoadError } from '../components/PageLoadError'

const TABS: Array<{ id: NotificationTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Messages your bug reporters see in the widget: how many, how recent, and whether updates are on.',
  },
  {
    id: 'inbox',
    label: 'Sent',
    description: 'Every update sent to a reporter, newest first; open one to see exactly what the widget received.',
  },
  {
    id: 'outbox',
    label: 'How they hear back',
    description: 'Email and push switches, message wording, and updates waiting for your review.',
  },
  {
    id: 'setup',
    label: 'Setup',
    description: 'Whether reporter notifications are enabled and how messages reach the widget.',
  },
]

function resolveNotificationTab(value: string | null): NotificationTabId {
  if (value === 'inbox' || value === 'outbox' || value === 'setup') return value
  return 'overview'
}

export function NotificationsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const copy = usePageCopy('/notifications')
  const ux = useNotificationsUx()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: NotificationTabId = resolveNotificationTab(tabParam)
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const filter = (searchParams.get('show') ?? 'all') as 'all' | 'unread'
  const type = searchParams.get('type') ?? ''

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (filter === 'unread') params.set('unread', '1')
    if (type) params.set('type', type)
    return params.toString()
  }, [filter, type])

  const listPath = activeProjectId
    ? `/v1/admin/notifications${queryString ? `?${queryString}` : ''}`
    : null
  const statsPath = activeProjectId ? '/v1/admin/notifications/stats' : null

  const {
    data,
    loading,
    error,
    reload,
    lastFetchedAt,
    isValidating,
  } = usePageData<{ notifications: ReporterNotification[] }>(listPath, {
    deps: [queryString, activeProjectId],
  })
  const {
    data: statsData,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<NotificationStats>(statsPath, {
    deps: [activeProjectId],
  })

  const stats = { ...EMPTY_NOTIFICATIONS_STATS, ...statsData }
  const fetchedAt = statsFetchedAt ?? lastFetchedAt
  const validating = isValidating || statsValidating

  const reloadAll = useCallback(() => {
    reload()
    reloadStats()
  }, [reload, reloadStats])

  useRealtimeReload(['reporter_notifications', 'project_settings'], reloadAll)

  const notifications = data?.notifications ?? []
  const unreadCount = stats.unread

  const setTab = useCallback(
    (tab: NotificationTabId) => {
      const next = new URLSearchParams(searchParams)
      if (tab === 'overview') next.delete('tab')
      else next.set('tab', tab)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  // Quick mode opens the posture tab once; links and clicks then win.
  useQuickstartLandingTab({
    enabled: ux.isQuickstart && Boolean(activeProjectId),
    ready: statsData != null,
    tabParam: tabParam,
    activeTab: activeTab,
    quickTab: resolveQuickNotificationsTab(stats),
    setActiveTab: setTab,
  })

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const [expanded, setExpanded] = useState<string | null>(null)
  const [bulking, setBulking] = useState(false)

  usePublishPageContext({
    route: '/notifications',
    title: tabbedPageTitle('Reporter updates', activeMeta.label, activeMeta.id === TABS[0].id),
    filters: { tab: activeTab, show: filter, type: type || undefined, project_id: activeProjectId ?? undefined },
    criticalCount: stats.notificationsEnabled ? 0 : 1,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      { id: 'inbox' as const, label: copy?.tabLabels?.inbox ?? 'Sent', count: stats.unread > 0 ? stats.unread : undefined },
      { id: 'outbox' as const, label: copy?.tabLabels?.outbox ?? 'How they hear back' },
      { id: 'setup' as const, label: copy?.tabLabels?.setup ?? 'Setup' },
    ],
    [copy?.tabLabels, stats.unread],
  )

  const markRead = async (id: string) => {
    try {
      const res = await apiFetch(`/v1/admin/notifications/${id}/read`, { method: 'POST' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed to mark as read')
      reloadAll()
    } catch (err) {
      toast.error('Could not mark as read', err instanceof Error ? err.message : String(err))
    }
  }

  const markAllRead = async () => {
    if (unreadCount === 0) return
    setBulking(true)
    try {
      const res = await apiFetch<{ marked_read: number }>('/v1/admin/notifications/read-all', {
        method: 'POST',
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed to mark all as read')
      toast.success(`Marked ${res.data?.marked_read ?? 0} as read`)
      reloadAll()
    } catch (err) {
      toast.error('Bulk mark-as-read failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBulking(false)
    }
  }

  if (!activeProjectId) {
    return (
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-notifications">
        <PageHeaderBar
          title={copy?.title ?? 'Reporter updates'}

          helpTitle={copy?.help?.title ?? 'About reporter updates'}
          helpWhatIsIt={
            copy?.help?.whatIsIt ??
            'Outbound messages for end users who submitted bug reports. The SDK polls this list and shows classification, fix-shipped, or reward updates in the reporter widget.'
          }
          helpUseCases={
            copy?.help?.useCases ?? [
              'Verify the SDK side of the loop — reporters see when their bug was classified or fixed',
              'Audit which reporter tokens received messages for a given report',
              'See which updates reporters have not opened yet',
            ]
          }
          helpHowToUse={
            copy?.help?.howToUse ??
            'Filter by type or unread on Inbox, expand a row for the JSON payload, and mark read once verified. Reporter updates must be on (Setup tab).'
          }
        />
        <NextStep
          variant="inline"
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Reporter notifications are scoped to the active project in the header."
        />
      </div>
    )
  }

  if (loading) {
    return <TableSkeleton rows={6} columns={4} showFilters label="Loading notifications" />
  }
  if (error) {
    return <PageLoadError error={error} resource="notifications" onRetry={reloadAll} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    stats.topPriority === 'disabled'
      ? 'warn'
      : stats.topPriority === 'healthy' || stats.topPriority === 'unread_backlog'
          ? 'ok'
          : stats.topPriority === 'no_messages'
            ? 'brand'
            : 'neutral'

  const headerBadge =
    stats.topPriority === 'healthy' || stats.topPriority === 'unread_backlog'
      ? 'ACTIVE'
      : stats.topPriority === 'disabled'
        ? 'DISABLED'
        : stats.total === 0
            ? 'EMPTY'
            : 'SETUP'

  return (
    <div className="space-y-4" data-testid="mushi-page-notifications">
      <PageHeaderBar
        title={copy?.title ?? 'Reporter updates'}
        projectScope={stats.projectName ?? projectName ?? undefined}

        helpTitle={copy?.help?.title ?? 'About reporter updates'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Outbound messages for end users who submitted bug reports. The SDK polls this list and shows classification, fix-shipped, or reward updates in the reporter widget.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Verify the SDK side of the loop — reporters see when their bug was classified or fixed',
            'Audit which reporter tokens received messages for a given report',
            'See which updates reporters have not opened yet',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Filter by type or unread on Inbox, expand a row for the JSON payload, and mark read once verified. Reporter updates must be on (Setup tab).'
        }
      >
        {!ux.hideOverviewChrome && (
          <>
            <Badge
              className={
                bannerSeverity === 'ok'
                  ? CHIP_TONE.ok
                  : bannerSeverity === 'warn'
                    ? CHIP_TONE.warn
                    : bannerSeverity === 'brand'
                      ? CHIP_TONE.neutral
                      : CHIP_TONE.neutral
              }
            >
              {headerBadge}
            </Badge>
            <FreshnessPill at={fetchedAt} isValidating={validating} />
          </>
        )}
        {/* Refresh, filters and Mark all read work in every mode: the page
            help tells everyone to filter the Inbox. */}
        <Btn variant="ghost" size="sm" onClick={reloadAll} loading={validating}>
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            // One status row: the summary below carries the count and the action.
            // The banner only speaks when that row is hidden (quick mode) or there is no app.
            priority: POSTURE_PRIORITY.status,
            show: !stats.hasAnyProject || ux.hideNotificationsSnapshot,
            children: (
              <NotificationsStatusBanner
                stats={stats}
                onTab={setTab}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideNotificationsSnapshot,
            children: (
              <NotificationsSnapshotStrip
                stats={stats}
                fetchedAt={fetchedAt}
                isValidating={validating}
                statLabels={copy?.statLabels}
                onTab={setTab}
              />
            ),
          },
        ]}
      />

      {/* Tabs above the summary: they sat under the funnel, so the page read as content first, then its own tabs. */}
      {!ux.hideTabs && (
      <SegmentedControl
        value={activeTab}
        onChange={setTab}
        options={tabOptions}
        ariaLabel="Notification sections"
        size="sm"
        scrollable
      />
      )}

      {stats.notificationsEnabled && stats.funnel && stats.funnel.told > 0 && activeTab === 'overview' ? (
        <ReporterUpdateFunnel funnel={stats.funnel} totalUpdates={stats.total} unopenedShownAbove={stats.unread > 0} />
      ) : null}

      {activeTab === 'overview' && stats.projectId ? (
        <NotificationsReadout stats={stats} fetchedAt={fetchedAt} isValidating={validating} />
      ) : null}

      {activeTab === 'inbox' && (
        // Filters ride in the inbox card's header at its size: in the page header they added two
        // rows of larger chrome above the status at 390 (2026-11-19). One row of same-height
        // filters, each named inside its select; the unread count is the status row's number.
        <Section
          title="Reporter inbox"
          action={
            <div className="flex flex-wrap items-center gap-1.5" data-testid="notifications-inbox-filters">
              <FilterSelect
                id="filter-show"
                label="updates"
                value={filter === 'unread' ? 'unread' : ''}
                options={['unread']}
                optionLabel={() => 'Unread only'}
                onChange={(e) => updateParam('show', e.currentTarget.value)}
              />
              <FilterSelect
                id="filter-type"
                label="types"
                value={type}
                options={TYPE_OPTIONS}
                onChange={(e) => updateParam('type', e.currentTarget.value)}
              />
              <ConfigHelp helpId="notifications.type_filter" />
              <Btn
                variant="ghost"
                size="sm"
                onClick={markAllRead}
                disabled={bulking || unreadCount === 0}
                loading={bulking}
              >
                Mark all read
              </Btn>
            </div>
          }
        >
          <div data-dav-anchor="notifications:decide">
            {notifications.length === 0 ? (
              filter === 'unread' || type ? (
                <EmptyState
                  icon={<HeroSearch accent="text-fg-faint" />}
                  title="No notifications match these filters"
                  description="Clear filters to see the full list for this project."
                  action={
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const next = new URLSearchParams(searchParams)
                        next.delete('show')
                        next.delete('type')
                        setSearchParams(next, { replace: true })
                      }}
                    >
                      Clear filters
                    </Btn>
                  }
                />
              ) : (
                <NextStep
                  variant="inline"
                  requires={['first_report_received']}
                  emptyTitle={
                    projectName
                      ? `No notifications for ${projectName} yet`
                      : 'No notifications yet'
                  }
                  emptyDescription="Messages fire when a report is classified, fixed, or rewarded. If reports exist but nothing shows here, check that reporter updates are on in Setup."
                  emptyAction={
                    <Btn variant="ghost" size="sm" onClick={() => setTab('setup')}>
                      Open Setup tab
                    </Btn>
                  }
                />
              )
            ) : (
              // Rows in the section's card, not a card per row (card in card).
              <ul className="divide-y divide-edge-subtle" data-testid="notifications-sent-rows">
                {notifications.map((n) => {
                  const isExpanded = expanded === n.id
                  const hasPayload = n.payload && Object.keys(n.payload).length > 0
                  return (
                    <li key={n.id} className={`py-2.5 ${n.read_at ? 'opacity-70' : ''}`} data-testid="notifications-sent-row">
                      {/* Actions wrap under the text on a phone, so the meta line keeps its width
                          (it stacked one clipped chip per line at 390: "11… / un… / to…"). */}
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                        {/* No "classified" chip: the title already says "Bug diagnosed" (2026-11-19). */}
                        <div className="min-w-0 flex-1 basis-48">
                          <p className="text-xs font-medium text-fg">{sentRowTitle(n)}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fg-secondary">
                            <span className="whitespace-nowrap">
                              <RelativeTime value={n.created_at} />
                            </span>
                            {n.read_at ? (
                              <span className="whitespace-nowrap">
                                opened <RelativeTime value={n.read_at} />
                              </span>
                            ) : null}
                            <span className="whitespace-nowrap" title={n.reporter_token_hash}>reporter · {reporterLabel(n.reporter_token_hash)}</span>
                            {n.report_id ? (
                              <ActionPill to={`/reports/${n.report_id}`} tone="brand">
                                report {n.report_id.slice(0, 8)}
                              </ActionPill>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {hasPayload && (
                            <Btn
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpanded(isExpanded ? null : n.id)}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? 'Hide payload' : 'Show payload'}
                            </Btn>
                          )}
                          {!n.read_at && (
                            <Btn variant="ghost" size="sm" onClick={() => void markRead(n.id)}>
                              Mark read
                            </Btn>
                          )}
                        </div>
                      </div>
                      {isExpanded && hasPayload && (
                        <div className="mt-2 pt-2 border-t border-edge-subtle">
                          <LogBlock
                            value={JSON.stringify(n.payload, null, 2)}
                            label="Payload"
                            tone="neutral"
                            maxHeightClass="max-h-64"
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Section>
      )}

      {activeTab === 'outbox' && activeProjectId && (
        <Section title="How reporters hear back">
          <div className="space-y-3">
            <ReporterChannelsCard projectId={activeProjectId} />
            <ReporterOutboxPanel projectId={activeProjectId} />
          </div>
        </Section>
      )}

      {activeTab === 'setup' && (
        <Section title="Pipeline checklist">
          <div className="space-y-3" data-dav-anchor="notifications:verify">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-fg">Reporter loop prerequisites</h3>
              <ReporterNotificationsToggle enabled={stats.notificationsEnabled} onChanged={reloadAll} />
              {/* Each prerequisite carries its state: met, off, or not seen yet (hollow). */}
              <ul className="space-y-2 text-xs text-fg-secondary" data-testid="notifications-setup-checks">
                {reporterSetupChecks(stats).map((check) => (
                  <li key={check.id} className="flex items-start gap-2" data-status={check.status}>
                    <StatusPill status={check.status} label={check.word} className="mt-px" />
                    <span className="min-w-0">{check.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-2xs text-fg-secondary">
                Team alerts (Slack, Discord, Teams) are separate:{' '}
                <Link to="/integrations/config#alerts" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
                  Alerts on Integrations
                </Link>
                .
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Btn variant="ghost" size="sm" onClick={() => navigate('/reports')}>
                  View bug queue
                </Btn>
              </div>
            </div>

            {/* One type is just the total again ("classified: 2"); the breakdown shows from two. */}
            {Object.keys(stats.byType).length > 1 && (
              <div className="space-y-2 border-t border-edge-subtle pt-3">
                <h3 className="text-sm font-semibold text-fg">Messages by type</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.byType).map(([t, count]) => (
                    <Badge key={t} className={TYPE_BADGE[t] ?? CHIP_TONE.neutral}>
                      {t}: {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
