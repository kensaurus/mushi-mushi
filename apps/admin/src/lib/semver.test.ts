import { describe, expect, it } from 'vitest'

import { compareSemver, resolveDisplayVersion } from './semver'

describe('compareSemver', () => {
  it('orders numeric semver segments', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareSemver('0.9.0', '0.10.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
  })

  it('ignores leading v and pre-release suffixes', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0)
    expect(compareSemver('1.2.3-beta.1', '1.2.3')).toBe(0)
  })
})

describe('resolveDisplayVersion', () => {
  it('shows changelog version with isNewer when changelog is ahead', () => {
    expect(resolveDisplayVersion('0.10.0', '0.9.0')).toEqual({ version: '0.10.0', isNewer: true })
  })

  it('shows build version without isNewer when build is ahead (pre-release deploy)', () => {
    expect(resolveDisplayVersion('0.9.0', '0.10.0')).toEqual({ version: '0.10.0', isNewer: false })
  })

  it('does not treat inequality alone as newer when build is ahead', () => {
    const result = resolveDisplayVersion('0.9.0', '0.10.0-rc.1')
    expect(result.isNewer).toBe(false)
    expect(result.version).toBe('0.10.0-rc.1')
  })

  it('falls back to build version when changelog is missing', () => {
    expect(resolveDisplayVersion(null, '0.9.0')).toEqual({ version: '0.9.0', isNewer: false })
  })
})
