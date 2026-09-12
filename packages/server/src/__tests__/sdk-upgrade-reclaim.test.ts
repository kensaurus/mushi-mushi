/**
 * FILE: sdk-upgrade-reclaim.test.ts
 * PURPOSE: Claim / reclaim / skip rules for stuck sdk_upgrade_jobs.
 */

import { describe, expect, it } from 'vitest'
import {
  SDK_UPGRADE_STALE_MS,
  shouldClaimSdkUpgradeJob,
} from '../../supabase/functions/_shared/sdk-upgrade-reclaim.ts'

const NOW = Date.parse('2026-08-28T01:00:00.000Z')

describe('shouldClaimSdkUpgradeJob', () => {
  it('claims a queued job', () => {
    expect(shouldClaimSdkUpgradeJob({ status: 'queued' }, NOW)).toBe('claim')
  })

  it('skips a completed or failed job', () => {
    expect(shouldClaimSdkUpgradeJob({ status: 'completed' }, NOW)).toBe('skip')
    expect(shouldClaimSdkUpgradeJob({ status: 'failed' }, NOW)).toBe('skip')
  })

  it('skips a running job started inside the stale window', () => {
    const started_at = new Date(NOW - SDK_UPGRADE_STALE_MS + 1_000).toISOString()
    expect(shouldClaimSdkUpgradeJob({ status: 'running', started_at }, NOW)).toBe('skip')
  })

  it('reclaims a running job older than the stale window', () => {
    const started_at = new Date(NOW - SDK_UPGRADE_STALE_MS).toISOString()
    expect(shouldClaimSdkUpgradeJob({ status: 'running', started_at }, NOW)).toBe('reclaim')
  })

  it('reclaims a running job with no started_at (lost CAS)', () => {
    expect(shouldClaimSdkUpgradeJob({ status: 'running', started_at: null }, NOW)).toBe('reclaim')
  })
})
