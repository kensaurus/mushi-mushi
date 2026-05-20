/**
 * FILE: apps/admin/src/components/cost/types.ts
 */

export type CostTabId = 'overview' | 'breakdown' | 'log'

export interface CostStats {
  projectId: string | null
  projectName: string | null
  totalSpendUsd: number
  spend24hUsd: number
  spend7dUsd: number
  spend30dUsd: number
  spendMonthUsd: number
  prior24hSpendUsd: number
  spendSpike24h: boolean
  calls24h: number
  calls7d: number
  calls30d: number
  totalCalls: number
  invocationCount: number
  ledgerCount: number
  operationsCount: number
  modelsCount: number
  topOperation: string | null
  topOperationUsd: number
  topModel: string | null
  topModelUsd: number
  lastCallAt: string | null
  failedCalls24h: number
  platformKeyCalls24h: number
  byokCalls24h: number
  byokAnthropicConfigured: boolean
  avgCostPerCall24h: number
}

export const EMPTY_COST_STATS: CostStats = {
  projectId: null,
  projectName: null,
  totalSpendUsd: 0,
  spend24hUsd: 0,
  spend7dUsd: 0,
  spend30dUsd: 0,
  spendMonthUsd: 0,
  prior24hSpendUsd: 0,
  spendSpike24h: false,
  calls24h: 0,
  calls7d: 0,
  calls30d: 0,
  totalCalls: 0,
  invocationCount: 0,
  ledgerCount: 0,
  operationsCount: 0,
  modelsCount: 0,
  topOperation: null,
  topOperationUsd: 0,
  topModel: null,
  topModelUsd: 0,
  lastCallAt: null,
  failedCalls24h: 0,
  platformKeyCalls24h: 0,
  byokCalls24h: 0,
  byokAnthropicConfigured: false,
  avgCostPerCall24h: 0,
}

export interface SummaryRow {
  day: string
  operation: string
  model: string
  total_cost_usd: number
  calls: number
}
