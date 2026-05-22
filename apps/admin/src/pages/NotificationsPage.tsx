/**
 * FILE: apps/admin/src/pages/NotificationsPage.tsx
 * PURPOSE: Reporter notification inbox — outbound messages the SDK widget polls.
 */

import { useCallback, useMemo, useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRealtimeReload } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { useNotificationsUx, resolveQuickNotificationsTab } from '../lib/notificationsModeUx'
import { notificationsLinks } from '../lib/statCardLinks'
import {
  PageHeader,
  PageHelp,
  Section,
  Card,
  Badge,
  Btn,
  EmptyState,
  ErrorAlert,
  FilterSelect,
  SelectField,
  LogBlock,
  StatCard,
  SegmentedControl,
  FreshnessPill,
  RecommendedAction,
  RelativeTime,
} from '../components/ui'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
  InlineProof,
} from '../components/report-detail/ReportSurface'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'
import { ConfigHelp } from '../components/ConfigHelp'
import { NotificationsStatusBanner } from '../components/notifications/NotificationsStatusBanner'
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
        <PageHeader title={copy?.title ?? 'Notifications'} />
        <ContainedBlock tone="muted" className="mb-1">
          <p className="text-xs leading-relaxed text-fg-muted">
            {copy?.description ??
              'Outbound messages the reporter SDK widget polls after classify, fix, or reward events.'}
          </p>
        </ContainedBlock>
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
      <PageHelp
        title={copy?.help?.title ?? 'About reporter notifications'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Outbound messages for end users who submitted bug reports. The SDK polls this list and shows classification, fix-shipped, or reward updates in the reporter widget.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Verify the SDK side of the loop — reporters see when their bug was classified or fixed',
            'Audit which reporter tokens received messages for a given report',
            'Spot stale unread rows that suggest client polling stopped working',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Filter by type or unread on Inbox, expand a row for the JSON payload, and mark read once verified. Requires reporter_notifications_enabled in Settings.'
        }
      />

      <PageHeader
        title={copy?.title ?? 'Notifications'}
        projectScope={stats.projectName ?? projectName ?? undefined}
      >
        {!ux.hideOverviewChrome && (
          <>
            <Badge
              className={
                bannerSeverity === 'ok'
                  ? 'bg-ok-muted text-ok'
                  : bannerSeverity === 'warn'
                    ? 'bg-warn/10 text-warn'
                    : bannerSeverity === 'brand'
                      ? 'bg-brand/15 text-brand'
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
      </PageHeader>

      <ContainedBlock tone="muted" className="mb-1">
        <p className="text-xs leading-relaxed text-fg-muted">
          {copy?.description ??
            'Banner + NOTIFICATIONS SNAPSHOT — Overview for posture, Inbox to debug payloads, Setup for pipeline checklist.'}
        </p>
      </ContainedBlock>

      <NotificationsStatusBanner
        stats={stats}
        onTab={setTab}
        onRefresh={reloadAll}
        refreshing={validating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl
        value={activeTab}
        onChange={setTab}
        options={tabOptions}
        ariaLabel="Notification sections"
        size="sm"
      />
      )}

      {!ux.hideNotificationsSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'NOTIFICATIONS SNAPSHOT'} freshness={{ at: fetchedAt, isValidating: validating }}>
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeMeta.description}</p>
        </ContainedBlock>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label={copy?.statLabels?.total ?? 'Total'}
            value={stats.total}
            accent={stats.total > 0 ? 'text-brand' : undefined}
            hint="Messages for this project"
            to={notificationsLinks.total}
          />
          <StatCard
            label={copy?.statLabels?.unread ?? 'Unread'}
            value={stats.unread}
            accent={stats.unread > 0 ? 'text-warn' : undefined}
            hint="Not yet marked read in admin"
            to={notificationsLinks.unread}
          />
          <StatCard
            label={copy?.statLabels?.last24h ?? 'Last 24h'}
            value={stats.last24h}
            accent={stats.last24h > 0 ? 'text-info' : undefined}
            hint="Recent outbound volume"
            to={notificationsLinks.last24h}
          />
          <StatCard
            label={copy?.statLabels?.enabled ?? 'Enabled'}
            value={stats.notificationsEnabled ? 'Yes' : 'No'}
            accent={stats.notificationsEnabled ? 'text-ok' : 'text-warn'}
            hint={stats.notificationsEnabled ? 'SDK polling allowed' : 'Turn on in Settings'}
            to={notificationsLinks.enabled}
          />
          <StatCard
            label={copy?.statLabels?.fixFailed ?? 'Fix failed'}
            value={stats.fixFailedCount}
            accent={stats.fixFailedCount > 0 ? 'text-danger' : undefined}
            hint="fix_failed type messages"
            to={notificationsLinks.fixFailed}
          />
          <StatCard
            label={copy?.statLabels?.lastMessage ?? 'Last message'}
            value={stats.lastNotificationAt ? 'Recent' : 'Never'}
            accent={stats.lastNotificationAt ? 'text-ok' : undefined}
            hint={
              stats.daysSinceLastNotification != null && stats.daysSinceLastNotification > 0
                ? `${stats.daysSinceLastNotification}d ago`
                : stats.lastNotificationAt
                  ? 'Today'
                  : 'Classify a report to test'
            }
            to={notificationsLinks.lastMessage}
          />
        </div>
      </Section>
      )}

      {!ux.hideOverviewChrome && stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'disabled' || stats.topPriority === 'unread_backlog'
              ? 'border-warn/30 bg-warn/5'
              : 'border-brand/30 bg-brand/5'
          }`}
        >
          <SignalChip tone={stats.topPriority === 'unread_backlog' ? 'warn' : stats.topPriority === 'disabled' ? 'warn' : 'brand'}>
            Needs attention
          </SignalChip>
          <ContainedBlock tone="info">
            <p className="text-xs font-medium leading-snug text-fg">{stats.topPriorityLabel}</p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill to={stats.topPriorityTo} tone="brand">
              Take action →
            </ActionPill>
          </ActionPillRow>
        </Card>
      ) : null}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {!ux.hideOverviewChrome && stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="Reporter loop active"
              description={stats.topPriorityLabel ?? `${stats.total} messages · all read.`}
              cta={{ label: 'View inbox', to: '/notifications?tab=inbox' }}
            />
          )}
          {!ux.hideOverviewChrome && stats.topPriority === 'disabled' && (
            <RecommendedAction
              tone="info"
              title="Enable reporter notifications"
              description={stats.topPriorityLabel ?? 'Turn on reporter_notifications_enabled in Settings.'}
              cta={{ label: 'Open Settings', to: '/settings' }}
            />
          )}
          {!ux.hideOverviewChrome && stats.topPriority === 'unread_backlog' && (
            <RecommendedAction
              tone="urgent"
              title="Review unread messages"
              description={stats.topPriorityLabel ?? 'Unread rows may mean the reporter SDK stopped polling.'}
              cta={{ label: 'Filter unread', to: '/notifications?tab=inbox&show=unread' }}
            />
          )}
          {!ux.hideOverviewChrome && stats.topPriority === 'no_messages' && (
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
