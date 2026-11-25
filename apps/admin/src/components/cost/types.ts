/**
 * FILE: apps/admin/src/components/cost/types.ts
 */

import type { CostTopPriority } from '../../lib/costExplainer'

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
  /** Calls the shared price book could not price: counted, never added as $0 to the totals above. */
  unpricedCalls30d: number
  unpricedCalls24h: number
  unpricedCallsOlder: number
  unpriced: UnpricedModelRow[]
  topPriority: CostTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
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
  unpricedCalls30d: 0,
  unpricedCalls24h: 0,
  unpricedCallsOlder: 0,
  unpriced: [],
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}

/** One model's unpriced calls in the last 30 days (GET /v1/admin/costs/stats). */
export interface UnpricedModelRow {
  provider: string
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  lastSeenAt: string
  reason: string
}

/** One day's check of the ledger against the provider's bill. */
export interface ReconcileRow {
  connector_instance_id: string
  provider: 'openai' | 'anthropic'
  day: string
  status: 'ok' | 'gap' | 'skipped' | 'error'
  vendor_usd: number | string | null
  ledger_usd: number | string | null
  ledger_unpriced_calls: number
  gap_usd: number | string | null
  gap_pct: number | string | null
  detail: Record<string, unknown> | null
  updated_at: string
}

/** GET /v1/admin/costs/reconciliation */
export interface CostReconciliation {
  providers: Array<{ provider: 'openai' | 'anthropic'; connected: boolean; hasAdminKey: boolean }>
  rows: ReconcileRow[]
}

export interface SummaryRow {
  day: string
  operation: string
  model: string
  /** Priced spend only. */
  total_cost_usd: number
  calls: number
  /** Calls in the bucket with no price in the price book (not in total_cost_usd). */
  unpriced_calls?: number
}
