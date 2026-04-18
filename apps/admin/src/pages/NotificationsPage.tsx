import { useState } from 'react'
import { useRealtime } from '../lib/realtime'
import { usePageData } from '../lib/usePageData'
import { PageHeader, PageHelp, Card, Badge, EmptyState, Loading, ErrorAlert, FilterSelect } from '../components/ui'
import { SetupNudge } from '../components/SetupNudge'

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
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const { data, loading, error, reload } = usePageData<{ notifications: ReporterNotification[] }>(
    '/v1/admin/notifications',
  )
  useRealtime({ table: 'reporter_notifications' }, reload)

  const notifications = data?.notifications ?? []
  const visible = filter === 'unread'
    ? notifications.filter((n) => !n.read_at)
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
        howToUse="This list is read-only. To send notifications, enable reporter_notifications_enabled in project_settings. The SDK widget polls GET /v1/notifications with the reporter token (and POSTs to /v1/notifications/:id/read once shown) to surface them in-app."
      />

      {loading ? (
        <Loading text="Loading notifications..." />
      ) : error ? (
        <ErrorAlert message={`Failed to load notifications: ${error}`} onRetry={reload} />
      ) : visible.length === 0 ? (
        filter === 'unread' ? (
          <EmptyState
            title="No unread notifications"
            description="Switch to \u201cAll\u201d to see read notifications."
          />
        ) : (
          <SetupNudge
            requires={['first_report_received']}
            emptyTitle="No notifications yet"
            emptyDescription="Notifications appear when the pipeline classifies, fixes, or rewards a report."
          />
        )
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
