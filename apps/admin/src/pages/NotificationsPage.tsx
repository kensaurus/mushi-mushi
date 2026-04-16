import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/supabase'
import { useRealtime } from '../lib/realtime'
import { PageHeader, PageHelp, Card, Badge, EmptyState, Loading, ErrorAlert, FilterSelect } from '../components/ui'

interface ReporterNotification {
  id: string
  project_id: string
  report_id: string | null
  reporter_token_hash: string
  type: string
  message: string | null
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

const TYPE_BADGE: Record<string, string> = {
  classified: 'bg-info-muted text-info',
  fixed: 'bg-ok-muted text-ok',
  fix_failed: 'bg-danger-muted text-danger',
  reward: 'bg-warn-muted text-warn',
}

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<ReporterNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const load = useCallback(async () => {
    setError(false)
    const res = await apiFetch<{ notifications: ReporterNotification[] }>('/v1/admin/notifications')
    if (res.ok && res.data) setNotifications(res.data.notifications)
    else setError(true)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useRealtime({ table: 'reporter_notifications' }, load)

  const visible = filter === 'unread'
    ? notifications.filter(n => !n.read_at)
    : notifications

  return (
    <div className="space-y-3">
      <PageHeader title="Reporter Notifications">
        <FilterSelect
          label="Show"
          value={filter}
          options={['all', 'unread']}
          onChange={(e) => setFilter(e.currentTarget.value as 'all' | 'unread')}
        />
      </PageHeader>

      <PageHelp
        title="About Notifications"
        whatIsIt="Outbound messages destined for reporters (the end users who submitted bug reports). The widget can poll this list to show classification updates, fix-shipped messages, or reward earnings. Each notification is keyed by the anonymous reporter_token_hash."
        useCases={[
          'Verify that the SDK side of the loop is working — reporter is told their bug landed',
          'Audit which reporters were notified about a specific report',
          'Spot stale unread notifications that suggest the SDK polling is broken on the client',
        ]}
        howToUse="This list is read-only. To send notifications, set reporter_notifications_enabled in project_settings. The widget should fetch /v1/notifications?token=… (not yet exposed) to display them."
      />

      {loading ? (
        <Loading text="Loading notifications..." />
      ) : error ? (
        <ErrorAlert message="Failed to load notifications." onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          description="Notifications appear when the pipeline classifies, fixes, or rewards a report."
        />
      ) : (
        <div className="space-y-1.5">
          {visible.map(n => (
            <Card key={n.id} className="p-3">
              <div className="flex items-start gap-3">
                <Badge className={TYPE_BADGE[n.type] ?? 'bg-surface-overlay text-fg-muted'}>
                  {n.type}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-fg">{n.message ?? '—'}</p>
                  <p className="mt-1 text-2xs text-fg-faint font-mono">
                    {new Date(n.created_at).toLocaleString()}
                    {n.read_at ? ` · read ${new Date(n.read_at).toLocaleString()}` : ' · unread'}
                    · tok:{n.reporter_token_hash.slice(0, 8)}…
                    {n.report_id ? ` · report:${n.report_id.slice(0, 8)}…` : ''}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
