/**
 * `_shared/radar/store-policy.ts` — the dated store-policy table and the
 * `play_target_sdk_behind` / `ios_sdk_behind` rules (Plan 020 §4.2, §5.5).
 * Covers every ok / finding / unknown path, a stale table reading unknown
 * (never ok), and a future row showing up as an info heads-up.
 */
import { describe, expect, it } from 'vitest'
import { evaluateStorePolicy, STORE_POLICIES, type StorePolicyRow } from '../../supabase/functions/_shared/radar/store-policy.ts'
import type { RepoFacts } from '../../supabase/functions/_shared/radar/types.ts'

const NOW = new Date('2026-10-02T12:00:00Z')

const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  androidTargetSdk: 36,
  androidTargetSdkSource: 'android/variables.gradle',
  xcodeMajor: 26,
  xcodeSource: '.github/workflows/build-mobile-capacitor.yml',
  iosDeploymentTarget: '15.0',
  iosDeploymentTargetSource: 'ios/App/App.xcodeproj/project.pbxproj',
  hasAndroid: true,
  hasIos: true,
  ...over,
})

const byRule = (results: ReturnType<typeof evaluateStorePolicy>) => ({
  android: results.find((r) => r.ruleId === 'play_target_sdk_behind')!,
  ios: results.find((r) => r.ruleId === 'ios_sdk_behind')!,
})

describe('the policy table', () => {
  it('cites a source and a verification date on every row', () => {
    for (const row of STORE_POLICIES) {
      expect(row.sourceUrl, row.id).toMatch(/^https:\/\/developer\.(android|apple)\.com\//)
      expect(row.lastVerified, row.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row.effectiveFrom, row.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('returns exactly one result per rule', () => {
    expect(evaluateStorePolicy(facts(), NOW).map((r) => r.ruleId)).toEqual(['play_target_sdk_behind', 'ios_sdk_behind'])
  })
})

describe('play_target_sdk_behind', () => {
  it('is ok at API 36', () => {
    const { android } = byRule(evaluateStorePolicy(facts(), NOW))
    expect(android.state).toBe('ok')
    expect(android.findings).toEqual([])
  })

  it('warns at API 35: updates are refused since 2026-08-31 unless extended', () => {
    const { android } = byRule(evaluateStorePolicy(facts({ androidTargetSdk: 35 }), NOW))
    expect(android.state).toBe('finding')
    expect(android.findings).toHaveLength(1)
    expect(android.findings[0]).toMatchObject({ severity: 'warn', filePath: 'android/variables.gradle' })
    expect(android.findings[0].message).toContain('2026-11-01')
    expect(android.findings[0].fix).toContain('targetSdkVersion = 36')
  })

  it('is an error below API 35: hidden from new users and updates refused', () => {
    const { android } = byRule(evaluateStorePolicy(facts({ androidTargetSdk: 34 }), NOW))
    expect(android.findings[0].severity).toBe('error')
    expect(android.reason).toMatch(/hides apps below API 35/)
  })

  it('is unknown when the target SDK could not be read, and ok when there is no Android build', () => {
    expect(byRule(evaluateStorePolicy(facts({ androidTargetSdk: null }), NOW)).android.state).toBe('unknown')
    const none = byRule(evaluateStorePolicy(facts({ hasAndroid: false, androidTargetSdk: null }), NOW)).android
    expect(none).toMatchObject({ state: 'ok', findings: [] })
    expect(none.reason).toMatch(/No Android build/)
  })

  it('uses the newest row in force: before 2026-08-31 there is no Play row in the table', () => {
    const before = byRule(evaluateStorePolicy(facts({ androidTargetSdk: 34 }), new Date('2026-08-01T00:00:00Z'))).android
    expect(before.state).toBe('unknown')
  })
})

describe('ios_sdk_behind', () => {
  it('is ok on Xcode 26 with a deployment target of iOS 13 or later', () => {
    expect(byRule(evaluateStorePolicy(facts(), NOW)).ios.state).toBe('ok')
  })

  it('is an error on Xcode 16 since 2026-04-28', () => {
    const { ios } = byRule(evaluateStorePolicy(facts({ xcodeMajor: 16 }), NOW))
    expect(ios.state).toBe('finding')
    expect(ios.findings[0]).toMatchObject({ severity: 'error', filePath: '.github/workflows/build-mobile-capacitor.yml' })
    expect(ios.findings[0].fix).toContain("xcode-version: '26'")
  })

  it('applied the Xcode 15 row before Xcode 26 took effect (and before the 120-day heads-up window)', () => {
    const { ios } = byRule(evaluateStorePolicy(facts({ xcodeMajor: 16 }), new Date('2025-12-01T00:00:00Z')))
    expect(ios.state).toBe('ok')
  })

  it('is an error for a deployment target below iOS 13 since 2026-09-09', () => {
    const { ios } = byRule(evaluateStorePolicy(facts({ iosDeploymentTarget: '12.4' }), NOW))
    expect(ios.findings.map((f) => f.severity)).toEqual(['error'])
    expect(ios.findings[0].message).toContain('iOS 12.4')
  })

  it('is unknown when the Xcode version could not be read, and ok when there is no iOS build', () => {
    expect(byRule(evaluateStorePolicy(facts({ xcodeMajor: null }), NOW)).ios.state).toBe('unknown')
    expect(byRule(evaluateStorePolicy(facts({ hasIos: false, xcodeMajor: null }), NOW)).ios.state).toBe('ok')
  })

  it('says when only the Xcode version could be checked', () => {
    const { ios } = byRule(evaluateStorePolicy(facts({ iosDeploymentTarget: null }), NOW))
    expect(ios.state).toBe('ok')
    expect(ios.reason).toMatch(/minimum iOS version was not found/)
  })
})

describe('staleness and upcoming rows', () => {
  it('a table last checked more than 90 days ago reads unknown, never ok', () => {
    const later = new Date('2027-02-01T00:00:00Z')
    const { android, ios } = byRule(evaluateStorePolicy(facts(), later))
    expect(android.state).toBe('unknown')
    expect(android.reason).toMatch(/policy table is stale/)
    expect(ios.state).toBe('unknown')
  })

  it('a future row within 120 days shows as an info heads-up when the app does not meet it yet', () => {
    const future: StorePolicyRow = {
      ...STORE_POLICIES.find((r) => r.id === 'play-2026-08-31-updates')!,
      id: 'play-2027-01-15-updates',
      requirement: 37,
      effectiveFrom: '2027-01-15',
    }
    const { android } = byRule(evaluateStorePolicy(facts(), NOW, [...STORE_POLICIES, future]))
    expect(android.state).toBe('finding')
    expect(android.findings).toEqual([expect.objectContaining({ severity: 'info' })])
    expect(android.findings[0].message).toContain('Coming on 2027-01-15')
    expect(android.reason).toMatch(/^Meets today's rule/)

    const met = byRule(evaluateStorePolicy(facts({ androidTargetSdk: 37 }), NOW, [...STORE_POLICIES, future])).android
    expect(met.state).toBe('ok')

    const farAway = { ...future, effectiveFrom: '2027-09-01' }
    expect(byRule(evaluateStorePolicy(facts(), NOW, [...STORE_POLICIES, farAway])).android.state).toBe('ok')
  })
})
