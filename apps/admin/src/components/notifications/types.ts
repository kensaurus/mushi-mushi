/**
 * FILE: apps/admin/src/components/notifications/types.ts
 */

import { CHIP_TONE } from '../../lib/chipTone'

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

export type NotificationTopPriority =
  | 'no_project'
  | 'disabled'
  | 'unread_backlog'
  | 'no_messages'
  | 'healthy'

export interface NotificationStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  total: number
  unread: number
  last24h: number
  lastNotificationAt: string | null
  daysSinceLastNotification: number | null
  byType: Record<string, number>
  notificationsEnabled: boolean
  fixFailedCount: number
  topPriority: NotificationTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_NOTIFICATIONS_STATS: NotificationStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  total: 0,
  unread: 0,
  last24h: 0,
  lastNotificationAt: null,
  daysSinceLastNotification: null,
  byType: {},
  notificationsEnabled: false,
  fixFailedCount: 0,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}

export type NotificationTabId = 'overview' | 'inbox' | 'setup'

export const TYPE_BADGE: Record<string, string> = {
  classified: CHIP_TONE.infoSubtle,
  fixed: CHIP_TONE.okSubtle,
  fix_failed: CHIP_TONE.dangerSubtle,
  reward: CHIP_TONE.warnSubtle,
  comment_reply: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
}

export const TYPE_OPTIONS = ['', 'classified', 'fixed', 'fix_failed', 'reward', 'comment_reply']
