/**
 * FILE: sdk-version-compare.test.ts
 * PURPOSE: Pin the server-side semver compare used for SDK catalogue
 *          freshness (`_shared/sdk-version-compare.ts`). The admin console
 *          keeps a hand-mirrored copy (`apps/admin/src/lib/sdkVersionCompare.ts`)
 *          — these cases must stay in sync with that file's test.
 */

import { describe, it, expect } from 'vitest'
import {
  compareSemver,
  resolveSdkFreshnessStatus,
  stripPreRelease,
} from '../../supabase/functions/_shared/sdk-version-compare.ts'

describe('stripPreRelease', () => {
  it('strips pre-release suffixes', () => {
    expect(stripPreRelease('1.8.0-beta.2')).toBe('1.8.0')
  })

  it('strips build metadata', () => {
    expect(stripPreRelease('1.7.5+build.1')).toBe('1.7.5')
  })

  it('strips at the first of - or +', () => {
    expect(stripPreRelease('2.0.0-rc.1+sha.abc')).toBe('2.0.0')
  })

  it('passes plain versions through', () => {
    expect(stripPreRelease('1.7.8')).toBe('1.7.8')
  })
})

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

  it('compares segment counts safely', () => {
    expect(compareSemver('1.7', '1.7.0')).toBe(0)
  })
})

describe('resolveSdkFreshnessStatus', () => {
  it('returns unknown when any input is missing', () => {
    expect(
      resolveSdkFreshnessStatus({
        sdkPackage: null,
        sdkVersion: '1.7.8',
        catalogVersion: '1.7.8',
        catalogDeprecated: false,
      }),
    ).toBe('unknown')
  })

  it('returns up-to-date when observed >= catalogue (stale catalogue safe)', () => {
    expect(
      resolveSdkFreshnessStatus({
        sdkPackage: '@mushi-mushi/web',
        sdkVersion: '1.7.8',
        catalogVersion: '0.9.0',
        catalogDeprecated: false,
      }),
    ).toBe('up-to-date')
  })

  it('returns outdated when catalogue is newer', () => {
    expect(
      resolveSdkFreshnessStatus({
        sdkPackage: '@mushi-mushi/web',
        sdkVersion: '1.6.0',
        catalogVersion: '1.7.8',
        catalogDeprecated: false,
      }),
    ).toBe('outdated')
  })

  it('only marks deprecated when observed <= the deprecated catalogue row', () => {
    expect(
      resolveSdkFreshnessStatus({
        sdkPackage: '@mushi-mushi/react-native',
        sdkVersion: '0.9.0',
        catalogVersion: '0.9.0',
        catalogDeprecated: true,
      }),
    ).toBe('deprecated')
    expect(
      resolveSdkFreshnessStatus({
        sdkPackage: '@mushi-mushi/react-native',
        sdkVersion: '0.13.1',
        catalogVersion: '0.9.0',
        catalogDeprecated: true,
      }),
    ).toBe('up-to-date')
  })
})
