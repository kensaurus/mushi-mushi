/**
 * FILE: apps/admin/src/pages/NotificationsPage.tsx
 * PURPOSE: Outbound messages destined for the SDK widget. Lets admins audit
 *          which reporters were notified about which report, mark stale items
 *          as read, and inspect the JSON payload that the widget polls.
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRealtime } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Btn,
  EmptyState,
  ErrorAlert,
  FilterSelect,
  SelectField,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { HeroSearch } from '../components/illustrations/HeroIllustrations'

interface ReporterNotification {
  id: string
  project_id: string
  report_id: string | null
  reporter_token_hash: string
  notification_type: string
  message: string | null
  payload: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

const TYPE_BADGE: Record<string, string> = {
  classified: 'bg-info-muted text-info',
  fixed: 'bg-ok-muted text-ok',
  fix_failed: 'bg-danger-muted text-danger',
  reward: 'bg-warn-muted text-warn',
}

const TYPE_OPTIONS = ['', 'classified', 'fixed', 'fix_failed', 'reward', 'comment_reply']

export function NotificationsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [bulking, setBulking] = useState(false)

  const filter = (searchParams.get('show') ?? 'all') as 'all' | 'unread'
  const type = searchParams.get('type') ?? ''

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (filter === 'unread') params.set('unread', '1')
    if (type) params.set('type', type)
    return params.toString()
  }, [filter, type])

  const { data, loading, error, reload } = usePageData<{ notifications: ReporterNotification[] }>(
    `/v1/admin/notifications${queryString ? `?${queryString}` : ''}`,
    { deps: [queryString] },
  )
  useRealtime({ table: 'reporter_notifications' }, reload)

  const notifications = data?.notifications ?? []
  const unreadCount = notifications.filter((n) => !n.read_at).length

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const markRead = async (id: string) => {
    try {
      const res = await apiFetch(`/v1/admin/notifications/${id}/read`, { method: 'POST' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed to mark as read')
      reload()
    } catch (err) {
      toast.error('Could not mark as read', err instanceof Error ? err.message : String(err))
    }
  }

  const markAllRead = async () => {
    if (unreadCount === 0) return
    setBulking(true)
    try {
      const res = await apiFetch<{ marked_read: number }>('/v1/admin/notifications/read-all', { method: 'POST' })
      if (!res.ok) throw new Error(res.error?.message ?? 'Failed to mark all as read')
      toast.success(`Marked ${res.data?.marked_read ?? 0} as read`)
      reload()
    } catch (err) {
      toast.error('Bulk mark-as-read failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBulking(false)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Reporter Notifications"
        description="Outbound messages sent to the people who reported the bugs — keeps the loop transparent."
      >
        <SelectField
          label="Show"
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
        <Btn
          variant="ghost"
          size="sm"
          onClick={markAllRead}
          disabled={bulking || unreadCount === 0}
          loading={bulking}
        >
          {`Mark all read${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
        </Btn>
      </PageHeader>

      <PageHelp
        title="About Notifications"
        whatIsIt="Outbound messages destined for reporters (the end users who submitted bug reports). The widget polls this list to show classification updates, fix-shipped messages, or reward earnings. Each notification is keyed by the anonymous reporter_token_hash."
        useCases={[
          'Verify that the SDK side of the loop is working — the reporter is told their bug landed',
          'Audit which reporters were notified about a specific report',
          'Spot stale unread notifications that suggest the SDK polling is broken on the client',
        ]}
        howToUse="Filter by type or unread, expand a row to see the full payload, click the report link to open triage. Outbound delivery is driven by reporter_notifications_enabled in project_settings."
      />

      {loading ? (
        <TableSkeleton rows={6} columns={4} showFilters={false} label="Loading notifications" />
      ) : error ? (
        <ErrorAlert message={`Failed to load notifications: ${error}`} onRetry={reload} />
      ) : notifications.length === 0 ? (
        filter === 'unread' || type ? (
          <EmptyState
            icon={<HeroSearch accent="text-fg-faint" />}
            title="No notifications match these filters"
            description="Switch back to All or clear the type filter to see the full list. Reporters only see what's listed here, so an empty filtered view does not mean the pipeline is silent."
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
            emptyTitle="No notifications yet"
            emptyDescription="Notifications fire when a report is classified, fixed, or rewarded — the SDK widget polls them so the reporter sees the loop close. If reports exist but nothing shows here, double-check reporter_notifications_enabled in /settings or wire a routing destination from /integrations."
            emptyAction={
              <Btn variant="ghost" size="sm" onClick={() => navigate('/integrations')}>
                Open Integrations
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
                  <Badge className={`${TYPE_BADGE[n.notification_type] ?? 'bg-surface-overlay text-fg-muted'} shrink-0`}>
                    {n.notification_type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-fg">{n.message ?? '—'}</p>
                    <p className="mt-1 text-2xs text-fg-faint font-mono">
                      {new Date(n.created_at).toLocaleString()}
                      {n.read_at ? ` · read ${new Date(n.read_at).toLocaleString()}` : ' · unread'}
                      {' · tok:'}{n.reporter_token_hash.slice(0, 8)}…
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
                      <Btn variant="ghost" size="sm" onClick={() => markRead(n.id)}>
                        Mark read
                      </Btn>
                    )}
                  </div>
                </div>
                {isExpanded && hasPayload && (
                  <div className="mt-2 pt-2 border-t border-edge-subtle">
                    <pre className="text-2xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap break-all bg-surface-overlay/30 rounded-sm p-2">
                      {JSON.stringify(n.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
