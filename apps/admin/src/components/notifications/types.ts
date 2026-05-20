/**
 * FILE: apps/admin/src/components/notifications/types.ts
 */

export interface ReporterNotification {
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

export interface NotificationStats {
  total: number
  unread: number
  last24h: number
  lastNotificationAt: string | null
  byType: Record<string, number>
  notificationsEnabled: boolean
}

export type NotificationTabId = 'inbox' | 'setup'

export const TYPE_BADGE: Record<string, string> = {
  classified: 'bg-info-muted text-info border border-info/30',
  fixed: 'bg-ok-muted text-ok border border-ok/30',
  fix_failed: 'bg-danger-muted text-danger border border-danger/30',
  reward: 'bg-warn-muted text-warn border border-warn/30',
  comment_reply: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
}

export const TYPE_OPTIONS = ['', 'classified', 'fixed', 'fix_failed', 'reward', 'comment_reply']
