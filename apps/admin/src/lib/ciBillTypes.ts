/**
 * FILE: apps/admin/src/lib/ciBillTypes.ts
 * PURPOSE: GET /v1/admin/ci/bill, copied from
 *          packages/server/supabase/functions/_shared/ci-bill-types.ts (the
 *          source of truth; change it there first). Billing money is
 *          measured from GitHub's bill; the agent PR share is estimated.
 */

interface CiBillMoney {
  grossUsd: number
  discountUsd: number
  netUsd: number
}

interface CiBillOwner {
  owner: string
  ownerType: 'User' | 'Organization' | null
  /** The last successful read (API or CLI push); null when none ever worked. */
  lastOkAt: string | null
  lastAttemptAt: string | null
  /** Why the last read failed, in plain words; null after a good read. */
  lastError: string | null
  lastSource: 'api' | 'cli' | null
  /** The first day Mushi holds this owner's bill from (YYYY-MM-DD). */
  coveredFrom: string | null
}

export interface CiBill {
  generatedAt: string
  window: { days: number; from: string; to: string }
  previousWindow: { from: string; to: string }
  /** Billing figures come from GitHub's bill. */
  provenance: 'measured'
  currency: 'USD'
  /** True when at least one owner's bill has been read. */
  available: boolean
  /** Why there is no bill yet, and how to connect one. Null when available. */
  unavailableReason: string | null
  owners: CiBillOwner[]
  /** The calendar month so far (UTC). */
  month: CiBillMoney & { label: string; from: string }
  totals: CiBillMoney & { minutes: number }
  /** The same span before the window; null when Mushi does not hold all of it. */
  previousTotals: (CiBillMoney & { minutes: number }) | null
  /** Net change against the previous window; null when it is not fully covered. */
  change: { netUsd: number; netPct: number | null } | null
  /** False when Mushi's bill starts after the window does. */
  windowComplete: boolean
  byRepo: Array<CiBillMoney & { repo: string; owner: string; minutes: number }>
  bySku: Array<CiBillMoney & { sku: string; unit: string; quantity: number }>
  /** One entry per day of the window, oldest first, zeros included. */
  byDay: Array<CiBillMoney & { day: string }>
  /** The newest day with a bill row (YYYY-MM-DD), or null. */
  dataThrough: string | null
  /**
   * GitHub-hosted minutes on private repos that ran on Mushi's agent branches,
   * against all such minutes, from the jobs Mushi recorded. Null without jobs.
   */
  agentShare: {
    provenance: 'estimated'
    billedMinutes: number
    agentBilledMinutes: number
    share: number | null
    branches: string[]
  } | null
}
