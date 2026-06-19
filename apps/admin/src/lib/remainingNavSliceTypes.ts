/**
 * Compact stat slices for sidebar badges — fields picked from /stats routes
 * that do not yet have dedicated page StatsTypes files.
 */

export interface McpNavSlice {
  mcpReadKeyCount: number
  neverConnectedCount: number
  endpointMismatch: boolean
  reportOnlyKeyCount: number
  topPriority: string
}

export interface MarketplaceNavSlice {
  failingPlugins: number
  neverDeliveredPlugins: number
  installedActive: number
  deliveriesFailed: number
  topPriority: string
}

export interface SettingsNavSlice {
  byokKeysFailing: number
  byokKeysUntested: number
  byokKeysConfigured: number
  slackConfigured: boolean
  githubRepoConfigured: boolean
}

export interface CostsNavSlice {
  spendSpike24h: boolean
  failedCalls24h: number
  calls24h: number
  spend24hUsd: number
}

export interface SsoNavSlice {
  failedCount: number
  pendingCount: number
  manualRequiredCount: number
  ssoEntitlement: boolean
}

export interface ComplianceNavSlice {
  controlsFail: number
  controlsWarn: number
  overdueDsars: number
  atRiskDsars: number
  soc2Entitlement: boolean
}

export interface StorageNavSlice {
  failingCount: number
  degradedCount: number
  neverProbedCount: number
  activeProjectHealthStatus: string
}

export interface QueryNavSlice {
  errors24h: number
  runs24h: number
  savedCount: number
  schemaDegraded: boolean
}

export interface IntegrationsNavSlice {
  platformDown: number
  platformConnected: number
  platformTotal: number
  routingPaused: number
}

export interface FeatureBoardNavSlice {
  openCount: number
  shippedCount: number
  totalVotes: number
  trendingCount: number
}

export interface SkillsNavSlice {
  catalogTotal: number
  activeRuns: number
  failedRuns: number
  awaitingCheckin: number
}
