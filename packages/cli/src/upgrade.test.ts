import { describe, expect, it } from 'vitest'
import { isNewerStableVersion } from './freshness.js'
import { formatUpgradeHint as hintFromUpgrade } from './upgrade.js'

describe('upgrade helpers', () => {
  it('formatUpgradeHint returns command when latest is newer', () => {
    const line = hintFromUpgrade('@mushi-mushi/web', '1.6.0', '1.7.8')
    expect(line).toContain('mushi upgrade')
    expect(line).toContain('1.7.8')
  })

  it('formatUpgradeHint returns null when already current', () => {
    expect(hintFromUpgrade('@mushi-mushi/web', '1.7.8', '1.7.8')).toBeNull()
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
