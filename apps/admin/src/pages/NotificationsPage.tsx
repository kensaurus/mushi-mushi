/**
 * FILE: apps/admin/src/pages/NotificationsPage.tsx
 * PURPOSE: Reporter notification inbox — outbound messages the SDK widget polls.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRealtimeReload } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { PageHero } from '../components/PageHero'
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
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'
import { ConfigHelp } from '../components/ConfigHelp'
import { NotificationsStatusBanner } from '../components/notifications/NotificationsStatusBanner'
import {
  TYPE_BADGE,
  TYPE_OPTIONS,
  type NotificationStats,
  type NotificationTabId,
  type ReporterNotification,
} from '../components/notifications/types'

const TABS: Array<{ id: NotificationTabId; label: string; description: string }> = [
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

function isTabId(v: string | null): v is NotificationTabId {
  return TABS.some((t) => t.id === v)
}

export function NotificationsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const copy = usePageCopy('/notifications')
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: NotificationTabId = isTabId(tabParam) ? tabParam : 'inbox'
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
  const { data: statsData, reload: reloadStats } = usePageData<NotificationStats>(statsPath, {
    deps: [activeProjectId],
  })

  const stats = statsData ?? {
    total: 0,
    unread: 0,
    last24h: 0,
    lastNotificationAt: null,
    byType: {},
    notificationsEnabled: false,
  }

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
      if (tab === 'inbox') next.delete('tab')
      else next.set('tab', tab)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const [expanded, setExpanded] = useState<string | null>(null)
  const [bulking, setBulking] = useState(false)

  const notifSeverity: 'ok' | 'warn' | 'crit' | 'neutral' = !stats.notificationsEnabled
    ? 'warn'
    : stats.unread > 0
      ? 'warn'
      : stats.total > 0
        ? 'ok'
        : 'neutral'

  usePublishPageContext({
    route: '/notifications',
    title: `${activeMeta.label} · Notifications`,
    summary: activeMeta.description,
    filters: { tab: activeTab, show: filter, type: type || undefined, project_id: activeProjectId ?? undefined },
    criticalCount: stats.unread + (stats.notificationsEnabled ? 0 : 1),
  })

  const tabOptions = useMemo(
    () => [
      { id: 'inbox' as const, label: 'Inbox', count: stats.unread > 0 ? stats.unread : undefined },
      { id: 'setup' as const, label: 'Setup' },
    ],
    [stats.unread],
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
        <PageHeader
          title={copy?.title ?? 'Notifications'}
          description={
            copy?.description ??
            'Outbound messages the reporter SDK widget polls after classify, fix, or reward events.'
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Reporter notifications'}
        description={
          copy?.description ??
          'Outbound messages for bug reporters — the SDK widget polls this queue so users see classify/fix updates.'
        }
        projectScope={projectName}
      >
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
      </PageHeader>

      <NotificationsStatusBanner stats={stats} projectName={projectName} />

      <PageHero
        scope="notifications"
        title={copy?.title ?? 'Notifications'}
        kicker="Reporter loop"
        decide={{
          label: stats.notificationsEnabled ? 'Notifications enabled' : 'Notifications off',
          metric: `${stats.unread} unread`,
          summary: stats.notificationsEnabled
            ? `${stats.total} messages queued for the SDK widget · ${stats.last24h} in the last 24 hours.`
            : 'Enable reporter notifications in Settings or reporters never see classify/fix updates in the widget.',
          severity: notifSeverity,
          anchor: 'notifications:decide',
          evidence: {
            kind: 'metric-breakdown',
            items: Object.entries(stats.byType).map(([label, value]) => ({
              label,
              value: String(value),
              tone: label === 'fix_failed' ? 'crit' : 'neutral',
            })),
          },
        }}
        verify={{
          label: stats.lastNotificationAt ? 'Last message' : 'No messages yet',
          detail: stats.lastNotificationAt
            ? new Date(stats.lastNotificationAt).toLocaleString()
            : 'Classify or fix a report — a message should land here when reporter_notifications_enabled is on.',
          to: '/settings',
          secondaryTo: '/reports',
          secondaryLabel: 'Triage queue',
          anchor: 'notifications:verify',
          evidence: stats.lastNotificationAt
            ? {
                kind: 'last-event',
                at: stats.lastNotificationAt,
                by: 'reporter_notifications',
                payloadSummary: `${stats.unread} unread`,
                status: stats.unread > 0 ? 'warn' : 'ok',
              }
            : undefined,
        }}
      />

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
          'Filter by type or unread, expand a row for the JSON payload, and mark read once verified. Requires reporter_notifications_enabled in Settings.'
        }
      />

      <Section title="Notification workspace" freshness={{ at: lastFetchedAt, isValidating }}>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total" value={stats.total} hint="Messages for this project" />
          <StatCard label="Unread" value={stats.unread} hint="Not yet marked read in admin" />
          <StatCard label="Last 24h" value={stats.last24h} hint="Recent outbound volume" />
          <StatCard
            label="Enabled"
            value={stats.notificationsEnabled ? 'Yes' : 'No'}
            hint={stats.notificationsEnabled ? 'SDK polling allowed' : 'Turn on in Settings'}
          />
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={setTab}
          options={tabOptions}
          ariaLabel="Notification sections"
          className="mb-4"
        />

        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {activeTab === 'inbox' && (
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
                          <p className="mt-1 text-2xs text-fg-faint font-mono">
                            {new Date(n.created_at).toLocaleString()}
                            {n.read_at
                              ? ` · read ${new Date(n.read_at).toLocaleString()}`
                              : ' · unread'}
                            {' · tok:'}
                            {n.reporter_token_hash.slice(0, 8)}…
                            {n.report_id ? (
                              <>
                                {' · '}
                                <Link to={`/reports/${n.report_id}`} className="text-brand hover:underline">
                                  report:{n.report_id.slice(0, 8)}…
                                </Link>
                              </>
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
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'setup' && (
          <div className="space-y-3" data-dav-anchor="notifications:verify">
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-fg">Pipeline checklist</h3>
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
        )}
      </Section>
    </div>
  )
}
