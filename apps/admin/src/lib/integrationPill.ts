/**
 * FILE: apps/admin/src/lib/integrationPill.ts
 * PURPOSE: One status word per integration on the Home card. The pill used
 *          to show the last probe's result alone, so "Claude Code agent ·
 *          3% up · Healthy" sat on the same row (console audit 2026-10-20,
 *          B4). The uptime share over the window and the last probe now
 *          agree: a service that failed most recent probes is degraded,
 *          whatever its very last probe said.
 */

export type IntegrationPillStatus = 'ok' | 'degraded' | 'down' | 'unknown'

/** Below this share of successful probes a "Healthy" last probe is not enough. */
const DEGRADED_UPTIME_BELOW = 0.95

export function integrationPillStatus(
  lastStatus: string | null | undefined,
  uptime: number | null | undefined,
): IntegrationPillStatus {
  if (lastStatus === 'down' || lastStatus === 'red' || lastStatus === 'fail') return 'down'
  if (lastStatus === 'degraded' || lastStatus === 'amber') return 'degraded'
  if (lastStatus === 'ok') {
    if (uptime != null && uptime < DEGRADED_UPTIME_BELOW) return 'degraded'
    return 'ok'
  }
  return 'unknown'
}
