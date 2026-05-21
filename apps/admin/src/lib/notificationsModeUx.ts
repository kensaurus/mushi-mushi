/**
 * FILE: apps/admin/src/lib/notificationsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Notifications page.
 */

import { useAdminMode } from './mode'
import type { NotificationStats, NotificationTabId } from '../components/notifications/types'

export interface NotificationsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideNotificationsSnapshot: boolean
}

export function useNotificationsUx(): NotificationsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideNotificationsSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to inbox when messages need attention, else setup. */
export function resolveQuickNotificationsTab(stats: NotificationStats): NotificationTabId {
  if (stats.topPriority === 'unread_backlog') return 'inbox'
  if (stats.topPriority === 'disabled' || stats.topPriority === 'no_messages') return 'setup'
  if (stats.total > 0) return 'inbox'
  return 'overview'
}
