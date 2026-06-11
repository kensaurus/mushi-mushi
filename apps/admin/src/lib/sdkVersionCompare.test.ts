import { describe, expect, it } from 'vitest'
import { compareSemver, resolveSdkDisplay } from './sdkVersionCompare'

describe('compareSemver', () => {
  it('orders 1.7.7 above 0.9.0', () => {
    expect(compareSemver('1.7.7', '0.9.0')).toBeGreaterThan(0)
  })

  it('treats equal cores as equal', () => {
    expect(compareSemver('1.7.8', '1.7.8')).toBe(0)
  })

  it('does not mis-parse build metadata as an older patch', () => {
    // "1.7.5+build.1" must compare equal to 1.7.5, not as 1.7.0.
    expect(compareSemver('1.7.5+build.1', '1.7.5')).toBe(0)
  })

  it('strips pre-release suffixes before comparing', () => {
    // Intentional for display purposes: a project running 1.8.0-beta.2 should
    // NOT see an "outdated" badge against catalog 1.8.0. Do not "fix" this to
    // strict SemVer ordering (where pre-release < release).
    expect(compareSemver('1.8.0-beta.2', '1.8.0')).toBe(0)
  })
})

describe('resolveSdkDisplay', () => {
  it('marks catalog-ahead when observed is newer than catalogue', () => {
    const res = resolveSdkDisplay({
      observedVersion: '1.7.7',
      latestVersion: '0.9.0',
      backendStatus: 'outdated',
    })
    expect(res.kind).toBe('catalog-ahead')
    expect(res.catalogStale).toBe(true)
    expect(res.upgradeTarget).toBeNull()
  })

  it('surfaces upgrade when catalogue is newer', () => {
    const res = resolveSdkDisplay({
      observedVersion: '1.6.0',
      latestVersion: '1.7.8',
      backendStatus: 'outdated',
    })
    expect(res.kind).toBe('upgrade-available')
    expect(res.upgradeTarget).toBe('1.7.8')
  })

  it('returns unknown when observed or catalogue data is missing', () => {
    expect(
      resolveSdkDisplay({ observedVersion: null, latestVersion: '1.7.8', backendStatus: 'outdated' }).kind,
    ).toBe('unknown')
    expect(
      resolveSdkDisplay({ observedVersion: '1.7.8', latestVersion: null, backendStatus: 'outdated' }).kind,
    ).toBe('unknown')
    expect(
      resolveSdkDisplay({ observedVersion: '1.7.8', latestVersion: '1.7.8', backendStatus: 'unknown' }).kind,
    ).toBe('unknown')
  })

  it('deprecated wins over version comparison and keeps the upgrade target', () => {
    const res = resolveSdkDisplay({
      observedVersion: '1.7.8',
      latestVersion: '1.7.8',
      backendStatus: 'up-to-date',
      deprecated: true,
    })
    expect(res.kind).toBe('deprecated')
    expect(res.upgradeTarget).toBe('1.7.8')
  })
})
