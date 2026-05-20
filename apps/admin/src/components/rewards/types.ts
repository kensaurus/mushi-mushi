/**
 * FILE: apps/admin/src/components/rewards/types.ts
 */

export type RewardsTabId =
  | 'overview'
  | 'rules'
  | 'tiers'
  | 'contributors'
  | 'quests'
  | 'analytics'
  | 'sandbox'
  | 'settings'

export type RewardsTopPriority =
  | 'no_org'
  | 'project_disabled'
  | 'webhooks_failing'
  | 'open_disputes'
  | 'no_rules'
  | 'high_rejection'
  | 'no_contributors'
  | 'healthy'

export interface RewardsStats {
  organizationId: string | null
  organizationName: string | null
  projectId: string | null
  projectName: string | null
  projectRewardsEnabled: boolean
  enabledRulesCount: number
  enabledTiersCount: number
  activeContributors30d: number
  pointsAwarded30d: number
  pendingPayoutLiabilityUsd: number
  activity24hTotal: number
  activity24hRejected: number
  rejectionRatePct24h: number
  webhooksConfigured: number
  webhooksFailing: number
  identityProvidersConfigured: number
  enabledQuestsCount: number
  openDisputesCount: number
  lastActivityAt: string | null
  topPriority: RewardsTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_REWARDS_STATS: RewardsStats = {
  organizationId: null,
  organizationName: null,
  projectId: null,
  projectName: null,
  projectRewardsEnabled: false,
  enabledRulesCount: 0,
  enabledTiersCount: 0,
  activeContributors30d: 0,
  pointsAwarded30d: 0,
  pendingPayoutLiabilityUsd: 0,
  activity24hTotal: 0,
  activity24hRejected: 0,
  rejectionRatePct24h: 0,
  webhooksConfigured: 0,
  webhooksFailing: 0,
  identityProvidersConfigured: 0,
  enabledQuestsCount: 0,
  openDisputesCount: 0,
  lastActivityAt: null,
  topPriority: 'no_org',
  topPriorityLabel: null,
  topPriorityTo: null,
}
