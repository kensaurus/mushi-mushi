import { describe, expect, it } from 'vitest'
import { isNewerStableVersion } from './freshness.js'
import {
  evaluateUpgradeCheckExit,
  type UpgradePlan,
} from './upgrade.js'

function plan(entries: UpgradePlan['entries']): UpgradePlan {
  return { cwd: '/tmp', packageManager: 'npm', entries, installCmd: null }
}

describe('upgrade helpers', () => {
  it('isNewerStableVersion is false for the same version', () => {
    expect(isNewerStableVersion('1.7.8', '1.7.8')).toBe(false)
  })

  it('isNewerStableVersion never nags toward a pre-release', () => {
    expect(isNewerStableVersion('1.8.0-rc.1', '1.7.8')).toBe(false)
  })

  it('isNewerStableVersion treats build metadata as stable', () => {
    expect(isNewerStableVersion('1.8.0+exp-sha.5114f85', '1.7.8')).toBe(true)
    expect(isNewerStableVersion('1.7.8+build.1', '1.7.8')).toBe(false)
  })

  it('isNewerStableVersion compares the current core ignoring its pre-release tag', () => {
    expect(isNewerStableVersion('1.8.0', '1.8.0-rc.1')).toBe(false)
    expect(isNewerStableVersion('1.8.1', '1.8.0-rc.1')).toBe(true)
  })
})

describe('evaluateUpgradeCheckExit', () => {
  it('exits 1 when no Mushi packages are declared', () => {
    expect(evaluateUpgradeCheckExit(plan([]))).toBe(1)
  })

  it('exits 0 when every semver pin is current', () => {
    expect(evaluateUpgradeCheckExit(plan([
      { name: '@mushi-mushi/web', current: '^1.27.0', latest: '1.27.0', willUpgrade: false },
    ]))).toBe(0)
  })

  it('exits 1 when any package will upgrade', () => {
    expect(evaluateUpgradeCheckExit(plan([
      { name: '@mushi-mushi/web', current: '1.26.0', latest: '1.27.0', willUpgrade: true },
    ]))).toBe(1)
  })

  it('exits 2 when every registry check failed', () => {
    expect(evaluateUpgradeCheckExit(plan([
      { name: '@mushi-mushi/web', current: '1.27.0', latest: null, willUpgrade: false },
    ]))).toBe(2)
  })

  it('exits 0 for file:/workspace pins (never auto-bumped)', () => {
    expect(evaluateUpgradeCheckExit(plan([
      { name: '@mushi-mushi/core', current: 'file:../../vendor/core.tgz', latest: null, willUpgrade: false },
    ]))).toBe(0)
  })
})
