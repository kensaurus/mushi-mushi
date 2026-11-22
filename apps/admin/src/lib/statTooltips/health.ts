/**
 * FILE: apps/admin/src/lib/statTooltips/health.ts
 * PURPOSE: One-line details for the Health snapshot tiles.
 */

export function fallbackRateDetail(): string {
  return 'Above 10% is degraded'
}

export function latencyDetail(): string {
  return 'Average / 95th percentile'
}
