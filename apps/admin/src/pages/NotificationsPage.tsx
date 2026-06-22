/**
 * FILE: apps/admin/src/pages/NotificationsPage.tsx
 * PURPOSE: Reporter notification inbox — outbound messages the SDK widget polls.
 */

import { useCallback, useMemo, useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRealtimeReload } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { useNotificationsUx, resolveQuickNotificationsTab } from '../lib/notificationsModeUx'
import {
  Section,
  Card,
  Badge,
  Btn,
  EmptyState,
  ErrorAlert,
  FilterSelect,
  SelectField,
  LogBlock,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
  RelativeTime,
} from '../components/ui'
import {
  ActionPill,
  SignalChip,
  InlineProof,
} from '../components/report-detail/ReportSurface'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { SetupNudge } from '../components/SetupNudge'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'
import { ConfigHelp } from '../components/ConfigHelp'
import { NotificationsStatusBanner } from '../components/notifications/NotificationsStatusBanner'
import { NotificationsSnapshotStrip } from '../components/notifications/NotificationsSnapshotStrip'
import { NotificationsReadout } from '../components/notifications/NotificationsReadout'
import {
  EMPTY_NOTIFICATIONS_STATS,
  TYPE_BADGE,
  TYPE_OPTIONS,
  type NotificationStats,
  type NotificationTabId,
  type ReporterNotification,
} from '../components/notifications/types'

const TABS: Array<{ id: NotificationTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Reporter loop posture — enabled state, unread backlog, volume, and recommended next steps.',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    description: 'Every outbound message keyed by reporter token — expand payloads to debug SDK polling.',
  },
  {
    id: 'setup',
    label: 'Setup',
    description: 'Whether reporter notifications are enabled and how messages reach the widget.',
  },
]

function resolveNotificationTab(value: string | null): NotificationTabId {
  if (value === 'inbox' || value === 'setup') return value
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
  usePublishPageHeroStats('/notifications', statsData)

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

  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId) return
    const quickTab = resolveQuickNotificationsTab(stats)
    if (activeTab !== quickTab) setTab(quickTab)
  }, [ux.isQuickstart, activeProjectId, stats, activeTab, setTab])

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
    title: `${activeMeta.label} · Notifications`,
    summary: activeMeta.description,
    filters: { tab: activeTab, show: filter, type: type || undefined, project_id: activeProjectId ?? undefined },
    criticalCount: stats.unread + (stats.notificationsEnabled ? 0 : 1),
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      { id: 'inbox' as const, label: copy?.tabLabels?.inbox ?? 'Inbox', count: stats.unread > 0 ? stats.unread : undefined },
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
      <div className="space-y-4">
        <PageHeaderBar
          title={copy?.title ?? 'Notifications'}
          description={copy?.description ?? 'Outbound messages the reporter SDK widget polls after classify, fix, or reward events.'}
          helpTitle={copy?.help?.title ?? 'About reporter notifications'}
          helpWhatIsIt={
            copy?.help?.whatIsIt ??
            'Outbound messages for end users who submitted bug reports. The SDK polls this list and shows classification, fix-shipped, or reward updates in the reporter widget.'
          }
          helpUseCases={
            copy?.help?.useCases ?? [
              'Verify the SDK side of the loop — reporters see when their bug was classified or fixed',
              'Audit which reporter tokens received messages for a given report',
              'Spot stale unread rows that suggest client polling stopped working',
            ]
          }
          helpHowToUse={
            copy?.help?.howToUse ??
            'Filter by type or unread on Inbox, expand a row for the JSON payload, and mark read once verified. Requires reporter_notifications_enabled in Settings.'
          }
        />
        <SetupNudge
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
    return <ErrorAlert message={`Failed to load notifications: ${error}`} onRetry={reloadAll} />
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    stats.topPriority === 'disabled'
      ? 'warn'
      : stats.topPriority === 'unread_backlog'
        ? 'warn'
        : stats.topPriority === 'healthy'
          ? 'ok'
          : stats.topPriority === 'no_messages'
            ? 'brand'
            : 'neutral'

  const headerBadge =
    stats.topPriority === 'healthy'
      ? 'ACTIVE'
      : stats.topPriority === 'disabled'
        ? 'DISABLED'
        : stats.topPriority === 'unread_backlog'
          ? `${stats.unread} UNREAD`
          : stats.total === 0
            ? 'EMPTY'
            : 'SETUP'

  return (
    <div className="space-y-4" data-testid="mushi-page-notifications">
      <PageHeaderBar
        title={copy?.title ?? 'Notifications'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        description={copy?.description ?? 'Outbound messages the reporter SDK widget polls after classify, fix, or reward events.'}
        helpTitle={copy?.help?.title ?? 'About reporter notifications'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Outbound messages for end users who submitted bug reports. The SDK polls this list and shows classification, fix-shipped, or reward updates in the reporter widget.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Verify the SDK side of the loop — reporters see when their bug was classified or fixed',
            'Audit which reporter tokens received messages for a given report',
            'Spot stale unread rows that suggest client polling stopped working',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Filter by type or unread on Inbox, expand a row for the JSON payload, and mark read once verified. Requires reporter_notifications_enabled in Settings.'
        }
      >
        {!ux.hideOverviewChrome && (
          <>
            <Badge
              className={
                bannerSeverity === 'ok'
                  ? 'bg-ok-muted text-ok'
                  : bannerSeverity === 'warn'
                    ? 'bg-warn-muted/50 text-warning-foreground'
                    : bannerSeverity === 'brand'
                      ? 'border border-edge-subtle bg-surface-raised text-fg-secondary'
                      : 'bg-surface-overlay text-fg-muted'
              }
            >
              {headerBadge}
            </Badge>
            <FreshnessPill at={fetchedAt} isValidating={validating} />
            <Btn variant="ghost" size="sm" onClick={reloadAll} loading={validating}>
              Refresh
            </Btn>
            {activeTab === 'inbox' && (
              <>
                <SelectField
                  label="Show"
                  helpId="notifications.show_filter"
                  value={filter}
                  onChange={(e) => updateParam('show', e.currentTarget.value)}
                  className="w-32"
                >
                  <option value="all">All</option>
                  <option value="unread">Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}</option>
                </SelectField>
                <FilterSelect
                  label="Type"
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
                  {`Mark all read${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
                </Btn>
              </>
            )}
          </>
        )}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <NotificationsStatusBanner
                stats={stats}
                onTab={setTab}
                onRefresh={reloadAll}
                refreshing={validating}
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
                sectionTitle={copy?.sections?.snapshot ?? 'NOTIFICATIONS SNAPSHOT'}
                hint={activeMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
        ]}
      />

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

      {activeTab === 'overview' && stats.projectId ? (
        <NotificationsReadout stats={stats} fetchedAt={fetchedAt} isValidating={validating} />
      ) : null}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="Reporter loop active"
              description={stats.topPriorityLabel ?? `${stats.total} messages · all read.`}
              cta={{ label: 'View inbox', to: '/notifications?tab=inbox' }}
            />
          )}
          {stats.topPriority === 'disabled' && (
            <RecommendedAction
              tone="info"
              title="Enable reporter notifications"
              description={stats.topPriorityLabel ?? 'Turn on reporter_notifications_enabled in Settings.'}
              cta={{ label: 'Open Settings', to: '/settings' }}
            />
          )}
          {stats.topPriority === 'unread_backlog' && (
            <RecommendedAction
              tone="urgent"
              title="Review unread messages"
              description={stats.topPriorityLabel ?? 'Unread rows may mean the reporter SDK stopped polling.'}
              cta={{ label: 'Filter unread', to: '/notifications?tab=inbox&show=unread' }}
            />
          )}
          {stats.topPriority === 'no_messages' && (
            <RecommendedAction
              tone="info"
              title="Send your first reporter message"
              description={stats.topPriorityLabel ?? 'Classify or fix a report to populate the inbox.'}
              cta={{ label: 'Open Setup', to: '/notifications?tab=setup' }}
            />
          )}
          {!ux.hideOverviewChrome && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-3 border-edge">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Classified</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-info">{stats.byType.classified ?? 0}</p>
              <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0">Triage updates to reporters</InlineProof>
            </Card>
            <Card className="p-3 border-edge">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Fixed</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ok">{stats.byType.fixed ?? 0}</p>
              <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0">Shipped fix notifications</InlineProof>
            </Card>
            <Card className="p-3 border-edge">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Last activity</p>
              <p className="mt-1 text-sm font-semibold text-fg-primary">
                {stats.lastNotificationAt ? <RelativeTime value={stats.lastNotificationAt} /> : 'Never'}
              </p>
              <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0">
                {stats.notificationsEnabled ? 'SDK polling enabled' : 'Notifications disabled'}
              </InlineProof>
            </Card>
          </div>
          )}
        </div>
      )}

      {activeTab === 'inbox' && (
        <Section title="Reporter inbox">
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
                <SetupNudge
                  requires={['first_report_received']}
                  emptyTitle={
                    projectName
                      ? `No notifications for ${projectName} yet`
                      : 'No notifications yet'
                  }
                  emptyDescription="Messages fire when a report is classified, fixed, or rewarded. If reports exist but nothing shows here, check reporter_notifications_enabled in Settings."
                  emptyAction={
                    <Btn variant="ghost" size="sm" onClick={() => setTab('setup')}>
                      Open Setup tab
                    </Btn>
                  }
                />
              )
            ) : (
              <div className="space-y-1">
                {notifications.map((n) => {
                  const isExpanded = expanded === n.id
                  const hasPayload = n.payload && Object.keys(n.payload).length > 0
                  return (
                    <Card key={n.id} className={`p-3 ${n.read_at ? 'opacity-70' : ''}`}>
                      <div className="flex items-start gap-3">
                        <Badge
                          className={`${TYPE_BADGE[n.notification_type] ?? 'bg-surface-overlay text-fg-muted border border-edge-subtle'} shrink-0`}
                        >
                          {n.notification_type}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-fg">{n.message ?? '—'}</p>
                          <InlineProof className="mt-1 flex flex-wrap gap-1 font-mono text-3xs border-0 bg-transparent px-0 py-0">
                            <SignalChip tone="neutral">{new Date(n.created_at).toLocaleString()}</SignalChip>
                            <SignalChip tone={n.read_at ? 'neutral' : 'brand'}>
                              {n.read_at
                                ? `read ${new Date(n.read_at).toLocaleString()}`
                                : 'unread'}
                            </SignalChip>
                            <SignalChip tone="neutral">tok:{n.reporter_token_hash.slice(0, 8)}…</SignalChip>
                            {n.report_id ? (
                              <ActionPill to={`/reports/${n.report_id}`} tone="brand">
                                report:{n.report_id.slice(0, 8)}…
                              </ActionPill>
                            ) : null}
                          </InlineProof>
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
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </Section>
      )}

      {activeTab === 'setup' && (
        <Section title="Pipeline checklist">
          <div className="space-y-3" data-dav-anchor="notifications:verify">
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-fg">Reporter loop prerequisites</h3>
              <ul className="space-y-2 text-xs text-fg-muted">
                <li className="flex items-start gap-2">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${stats.notificationsEnabled ? 'bg-ok' : 'bg-warn'}`}
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium text-fg">reporter_notifications_enabled</span>{' '}
                    — {stats.notificationsEnabled ? 'on' : 'off'} in project Settings
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
                  <span>
                    SDK must poll <span className="font-mono text-fg-secondary">GET /v1/notifications</span> with the
                    reporter token after ingest
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
                  <span>
                    Operator routing (Slack, PagerDuty) lives on{' '}
                    <Link to="/integrations/config" className="text-brand hover:underline">
                      Integrations
                    </Link>{' '}
                    — separate from reporter widget messages
                  </span>
                </li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link to="/settings">
                  <Btn size="sm">Open Settings</Btn>
                </Link>
                <Btn variant="ghost" size="sm" onClick={() => navigate('/reports')}>
                  View triage queue
                </Btn>
              </div>
            </Card>

            {Object.keys(stats.byType).length > 0 && (
              <Card className="p-4 space-y-2">
                <h3 className="text-sm font-semibold text-fg">Messages by type</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.byType).map(([t, count]) => (
                    <Badge key={t} className={TYPE_BADGE[t] ?? 'bg-surface-overlay text-fg-muted'}>
                      {t}: {count}
                    </Badge>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
