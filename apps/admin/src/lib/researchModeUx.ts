/**
 * FILE: apps/admin/src/lib/researchModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Research page.
 */

import { useAdminMode } from './mode'
import type { ResearchStats, ResearchTabId } from '../components/research/ResearchStatsTypes'

export interface ResearchUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideResearchSnapshot: boolean
}

export function useResearchUx(): ResearchUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideResearchSnapshot: isQuickstart,
  }
}

/** Quick mode: search when ready, history when sessions exist, else overview for setup. */
export function resolveQuickResearchTab(stats: ResearchStats): ResearchTabId {
  if (
    stats.topPriority === 'firecrawl_not_configured' ||
    stats.topPriority === 'firecrawl_auth_failed' ||
    stats.topPriority === 'firecrawl_error' ||
    stats.topPriority === 'firecrawl_untested'
  ) {
    return 'overview'
  }
  if (stats.topPriority === 'ready_no_sessions' || stats.topPriority === 'unattached_snippets') return 'search'
  if (stats.sessions > 0) return 'history'
  return 'search'
}
