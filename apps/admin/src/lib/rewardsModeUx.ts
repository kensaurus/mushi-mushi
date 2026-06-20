/**
 * FILE: rewardsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Rewards page — keeps Quick/Beginner
 *          surfaces simple without scattering `useAdminMode()` branches.
 */

import { useAdminMode } from './mode'
import type { RewardsStats, RewardsTabId, RewardsTopPriority } from '../components/rewards/types'

export interface RewardsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Hide URL tabs — land on the tab that matches posture. */
  hideTabs: boolean
  /** Use plain-language status banner CTAs. */
  plainBanner: boolean
  /** Hide REWARDS SNAPSHOT KPI strip in Quick mode. */
  hideRewardsSnapshot: boolean
  /** 4 headline stats instead of 6 on the snapshot strip. */
  compactSnapshot: boolean
  /** Hide snapshot footer drill-down links. */
  hideSnapshotLinks: boolean
  /** Suppress economy guide when status banner already covers the same priority. */
  hideEconomyGuide: boolean
}

const BANNER_COVERED_PRIORITIES: RewardsTopPriority[] = [
  'webhooks_failing',
  'open_disputes',
  'no_rules',
  'high_rejection',
  'project_disabled',
]

export function shouldHideEconomyGuide(topPriority: RewardsTopPriority | undefined): boolean {
  if (!topPriority) return false
  return BANNER_COVERED_PRIORITIES.includes(topPriority)
}

export function useRewardsUx(stats?: RewardsStats): RewardsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  const topPriority = stats?.topPriority
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideRewardsSnapshot: isQuickstart,
    compactSnapshot: isQuickstart || isBeginner,
    hideSnapshotLinks: !isAdvanced,
    hideEconomyGuide: shouldHideEconomyGuide(topPriority),
  }
}

/** Quick mode: jump to the panel that matches rewards posture. */
export function resolveQuickRewardsTab(stats: RewardsStats): RewardsTabId {
  if (stats.topPriority === 'webhooks_failing' || stats.topPriority === 'open_disputes') {
    return 'settings'
  }
  if (stats.topPriority === 'no_rules') return 'rules'
  if (stats.topPriority === 'high_rejection') return 'overview'
  if (stats.topPriority === 'no_contributors') return 'sandbox'
  if (stats.topPriority === 'project_disabled') return 'settings'
  return 'overview'
}

/** Beginner mode: primary tabs only; advanced tabs live behind overflow. */
export const REWARDS_PRIMARY_TABS: RewardsTabId[] = [
  'overview',
  'publishing',
  'rules',
  'tiers',
  'contributors',
]

export const REWARDS_OVERFLOW_TABS: RewardsTabId[] = [
  'quests',
  'analytics',
  'sandbox',
  'settings',
]
