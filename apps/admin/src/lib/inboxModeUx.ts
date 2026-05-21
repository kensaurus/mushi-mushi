/**
 * FILE: apps/admin/src/lib/inboxModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Action Inbox page.
 */

import { useAdminMode } from './mode'
import type { InboxStats, InboxTabId } from '../components/inbox/types'

export interface InboxUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Quick: Actions tab only — no Overview / Stages / Activity chrome. */
  hideTabs: boolean
  /** Use plain-language status banner CTAs. */
  plainBanner: boolean
  /** Hide PageHero + top-priority card on Overview. */
  hideOverviewChrome: boolean
  /** Hide INBOX SNAPSHOT KPI strip in Quick mode. */
  hideInboxSnapshot: boolean
  /** Hide PDCA stage labels on cards — plain group names only. */
  plainStageLabels: boolean
}

export function useInboxUx(): InboxUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideInboxSnapshot: isQuickstart,
    plainStageLabels: !isAdvanced,
  }
}

/** Quick mode: jump to Actions when work is waiting, else Overview. */
export function resolveQuickInboxTab(stats: InboxStats): InboxTabId {
  if (stats.openActions > 0) return 'actions'
  return 'overview'
}
