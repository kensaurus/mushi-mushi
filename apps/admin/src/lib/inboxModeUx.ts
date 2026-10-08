/**
 * FILE: apps/admin/src/lib/inboxModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Action Inbox page.
 */

import { useAdminMode } from './mode'
import type { InboxTabId } from '../components/inbox/types'

export interface InboxUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Quick: the action list only — no Stages / Activity tab bar. */
  hideTabs: boolean
  /** Use plain-language status banner CTAs. */
  plainBanner: boolean
}

export function useInboxUx(): InboxUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
  }
}

/**
 * Quick mode lands on Overview, which is the action list. Activity, opened on
 * purpose from inbox-zero's "View activity", stays open (it used to snap
 * straight back).
 */
export function resolveQuickInboxTab(current?: InboxTabId): InboxTabId {
  if (current === 'activity') return 'activity'
  return 'overview'
}
