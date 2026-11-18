/**
 * FILE: apps/admin/src/lib/costView.ts
 * PURPOSE: Team → AI spend, one place for the numbers the page draws
 *          (round-2 review 2026-11-18):
 *          - one money format, 4 decimals ($0.0203 next to $0.002500 next to
 *            $0.006080 read as three different units);
 *          - the key-source tile reads the calls that ran, not the legacy
 *            `byokAnthropicConfigured` flag (it only sees an Anthropic key in
 *            project_settings, so "12 BYOK" showed amber with "Add BYOK");
 *          - tile details short enough to stay whole at 390.
 */

import type { CostStats } from '../components/cost/types'

/** `$12.40`, `$0.0203`, `<$0.0001`, `$0`. Never 6 decimals. */
export function formatSpendUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0'
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n < 0.0001) return '<$0.0001'
  return `$${n.toFixed(4)}`
}

/**
 * Calls ran on Mushi Mushi's platform keys and none on the team's own key.
 * The one key-source state worth a warning; BYOK calls in the window mean a
 * key is set, whatever the legacy flag says.
 */
export function usesPlatformKeysOnly(stats: Pick<CostStats, 'byokCalls24h' | 'platformKeyCalls24h'>): boolean {
  return stats.platformKeyCalls24h > 0 && stats.byokCalls24h === 0
}

export interface KeySourceView {
  value: string
  tone: 'neutral' | 'warn' | 'muted'
  detail: string
}

export function keySourceView(stats: Pick<CostStats, 'byokCalls24h' | 'platformKeyCalls24h'>): KeySourceView {
  const { byokCalls24h: own, platformKeyCalls24h: platform } = stats
  if (own === 0 && platform === 0) return { value: 'No calls', tone: 'muted', detail: 'None in the last 24h' }
  if (usesPlatformKeysOnly(stats)) {
    return { value: `${platform} platform`, tone: 'warn', detail: 'Add your key in Settings' }
  }
  return {
    value: `${own} BYOK`,
    tone: 'neutral',
    detail: platform > 0 ? `${platform} on platform keys` : 'All on your own key',
  }
}

/** Tile details for the spend strip; each fits a 390px two-column tile. */
export function costTileDetails(stats: CostStats): {
  spend24h: string
  month: string
  operations: string
  topDriver: string
} {
  const calls = stats.calls24h
  return {
    spend24h:
      calls === 0
        ? 'No calls in 24h'
        : `${calls.toLocaleString()} call${calls === 1 ? '' : 's'} · avg ${formatSpendUsd(stats.avgCostPerCall24h)}`,
    month: `Last 7 days ${formatSpendUsd(stats.spend7dUsd)}`,
    operations: 'Steps · last 30 days',
    topDriver: stats.topOperation
      ? `${formatSpendUsd(stats.topOperationUsd)} · ${stats.topModel ?? 'no model'}`
      : 'Run classify or fix first',
  }
}
