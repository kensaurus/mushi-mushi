/**
 * FILE: rewardsTabs.ts
 * PURPOSE: Shared tab metadata for the Rewards console URL-driven layout.
 */

import type { RewardsTabId } from './types'

export interface RewardsTabMeta {
  id: RewardsTabId
  label: string
  description: string
}

export const REWARDS_TABS: RewardsTabMeta[] = [
  { id: 'overview', label: 'Overview', description: 'KPIs, tier distribution, and pending payouts at a glance.' },
  { id: 'publishing', label: 'Bounties', description: 'Publish this app to the Mushi Bounties marketplace and reward testers for finding bugs.' },
  { id: 'rules', label: 'Activity rules', description: 'Points awarded per SDK action, daily caps, and lifetime limits.' },
  { id: 'tiers', label: 'Tier ladder', description: 'Tier names, point thresholds, and monetary reward amounts.' },
  { id: 'contributors', label: 'Contributors', description: 'Leaderboard of identified users by points and tier.' },
  { id: 'quests', label: 'Quests', description: 'Multi-step goals that unlock bonus points for guided flows.' },
  { id: 'analytics', label: 'Retention', description: 'Retention lift for top-tier contributors vs everyone else.' },
  { id: 'sandbox', label: 'Simulator', description: 'Simulate any activity log against current rules without real data.' },
  { id: 'settings', label: 'Settings', description: 'Webhooks, identity providers, payout ledger, and disputes.' },
]

export function isRewardsTabId(v: string | null): v is RewardsTabId {
  return REWARDS_TABS.some((t) => t.id === v)
}

/** Legacy deep links from stat cards / hero tiles before Settings tab consolidation. */
const LEGACY_TAB_ALIASES: Record<string, RewardsTabId> = {
  webhooks: 'settings',
  disputes: 'settings',
}

export function resolveRewardsTabParam(v: string | null): RewardsTabId {
  if (!v) return 'overview'
  if (isRewardsTabId(v)) return v
  return LEGACY_TAB_ALIASES[v] ?? 'overview'
}

export function rewardsTabMeta(id: RewardsTabId): RewardsTabMeta {
  return REWARDS_TABS.find((t) => t.id === id) ?? REWARDS_TABS[0]
}
