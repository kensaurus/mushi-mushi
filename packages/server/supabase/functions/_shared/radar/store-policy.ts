/**
 * FILE: packages/server/supabase/functions/_shared/radar/store-policy.ts
 * PURPOSE: The dated store-policy table Mushi maintains (Plan 020 §5.5) and
 *          the two rules that read it: `play_target_sdk_behind` and
 *          `ios_sdk_behind`. Pure; the facts come from repo-scan.ts (files at
 *          a pinned SHA) or from the host's CI.
 *
 * Every row cites its source and the day it was last checked. A row checked
 * more than 90 days ago makes its rule `unknown` ("the policy table is
 * stale"), never `ok`: store rules change, and an old table must not pass an
 * app it no longer describes.
 */

import type { DetectorResult, RadarFinding, RepoFacts } from './types.ts'

export type PolicyRule = 'play_target_sdk_behind' | 'ios_sdk_behind'

/**
 * - `target_sdk`: minimum Android `targetSdkVersion`.
 * - `xcode_major`: minimum Xcode major an App Store Connect upload is built with.
 * - `min_deployment_target`: minimum iOS deployment target an upload declares.
 */
export type PolicyKind = 'target_sdk' | 'xcode_major' | 'min_deployment_target'

export interface StorePolicyRow {
  id: string
  platform: 'android' | 'ios'
  rule: PolicyRule
  kind: PolicyKind
  /** For `target_sdk` rows: `updates` = new apps and updates; `existing` = to stay visible to new users. */
  audience: 'updates' | 'existing' | 'uploads'
  requirement: number
  /** ISO date the requirement takes effect. */
  effectiveFrom: string
  appliesTo: string
  sourceUrl: string
  /** ISO date someone last read the source and confirmed this row. */
  lastVerified: string
  note: string
}

const ANDROID_SOURCE = 'https://developer.android.com/google/play/requirements/target-sdk'
const APPLE_SOURCE = 'https://developer.apple.com/news/upcoming-requirements/'

export const STORE_POLICIES: readonly StorePolicyRow[] = [
  {
    id: 'play-2026-08-31-updates',
    platform: 'android',
    rule: 'play_target_sdk_behind',
    kind: 'target_sdk',
    audience: 'updates',
    requirement: 36,
    effectiveFrom: '2026-08-31',
    appliesTo: 'New apps and app updates submitted to Google Play',
    sourceUrl: ANDROID_SOURCE,
    lastVerified: '2026-10-02',
    note:
      '"Starting August 31 2026: New apps and app updates must target Android 16 (API level 36) or higher". ' +
      'An extension to November 1, 2026 can be requested in Play Console.',
  },
  {
    id: 'play-2026-08-31-existing',
    platform: 'android',
    rule: 'play_target_sdk_behind',
    kind: 'target_sdk',
    audience: 'existing',
    requirement: 35,
    effectiveFrom: '2026-08-31',
    appliesTo: 'Existing apps that should stay available to new users',
    sourceUrl: ANDROID_SOURCE,
    lastVerified: '2026-10-02',
    note:
      '"Existing apps must target Android 15 (API level 35) or higher to remain available to new users on devices ' +
      'running Android OS higher than your app\'s target API level."',
  },
  {
    id: 'asc-2024-04-29-xcode15',
    platform: 'ios',
    rule: 'ios_sdk_behind',
    kind: 'xcode_major',
    audience: 'uploads',
    requirement: 15,
    effectiveFrom: '2024-04-29',
    appliesTo: 'Builds uploaded to App Store Connect',
    sourceUrl: APPLE_SOURCE,
    lastVerified: '2026-10-02',
    note: '"Apps uploaded to App Store Connect must be built with Xcode 15 for iOS 17 ... starting April 29, 2024."',
  },
  {
    id: 'asc-2026-04-28-xcode26',
    platform: 'ios',
    rule: 'ios_sdk_behind',
    kind: 'xcode_major',
    audience: 'uploads',
    requirement: 26,
    effectiveFrom: '2026-04-28',
    appliesTo: 'Builds uploaded to App Store Connect',
    sourceUrl: APPLE_SOURCE,
    lastVerified: '2026-10-02',
    note: '"Since April 28, 2026: Apps uploaded to App Store Connect must be built with Xcode 26 or later using an SDK for iOS 26".',
  },
  {
    id: 'asc-2026-09-09-ios13',
    platform: 'ios',
    rule: 'ios_sdk_behind',
    kind: 'min_deployment_target',
    audience: 'uploads',
    requirement: 13,
    effectiveFrom: '2026-09-09',
    appliesTo: 'iOS and iPadOS builds uploaded to App Store Connect',
    sourceUrl: APPLE_SOURCE,
    lastVerified: '2026-10-02',
    note: '"Since September 9, 2026: iOS and iPadOS apps uploaded to App Store Connect must target iOS 13 or later."',
  },
]

const DAY_MS = 86_400_000
/** A row checked longer ago than this makes its rule unknown. */
export const POLICY_STALE_DAYS = 90
/** Future rows within this window show up as an `info` heads-up. */
export const POLICY_UPCOMING_DAYS = 120

const ANDROID_FIX_FILE = 'android/variables.gradle (Capacitor), android/build.gradle (React Native) or app.json (Expo)'

function dayOf(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

function isStale(row: StorePolicyRow, now: Date): boolean {
  return now.getTime() - dayOf(row.lastVerified) > POLICY_STALE_DAYS * DAY_MS
}

/** The newest in-force row per (kind, audience) for one rule. */
function inForce(rows: readonly StorePolicyRow[], rule: PolicyRule, now: Date): StorePolicyRow[] {
  const best = new Map<string, StorePolicyRow>()
  for (const r of rows) {
    if (r.rule !== rule || dayOf(r.effectiveFrom) > now.getTime()) continue
    const key = `${r.kind}:${r.audience}`
    const cur = best.get(key)
    if (!cur || dayOf(r.effectiveFrom) > dayOf(cur.effectiveFrom)) best.set(key, r)
  }
  return [...best.values()]
}

function upcoming(rows: readonly StorePolicyRow[], rule: PolicyRule, now: Date): StorePolicyRow[] {
  const t = now.getTime()
  return rows.filter((r) => r.rule === rule && dayOf(r.effectiveFrom) > t && dayOf(r.effectiveFrom) - t <= POLICY_UPCOMING_DAYS * DAY_MS)
}

/** `14.0` → 14, `12.4` → 12.4. null when unreadable. */
function versionNumber(v: string | null): number | null {
  if (!v) return null
  const m = /^(\d+)(?:\.(\d+))?/.exec(v.trim())
  if (!m) return null
  return Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0)
}

function staleResult(rule: PolicyRule, rows: StorePolicyRow[]): DetectorResult {
  const oldest = rows.map((r) => r.lastVerified).sort()[0]
  return {
    ruleId: rule,
    state: 'unknown',
    reason: `The policy table is stale: it was last checked on ${oldest}, more than ${POLICY_STALE_DAYS} days ago. Mushi will not pass or fail the app on old store rules.`,
    findings: [],
  }
}

function withFindings(rule: PolicyRule, findings: RadarFinding[], okReason: string): DetectorResult {
  if (findings.length === 0) return { ruleId: rule, state: 'ok', reason: okReason, findings }
  const worst = findings.some((f) => f.severity === 'error') ? 'error' : findings.some((f) => f.severity === 'warn') ? 'warn' : 'info'
  const reason =
    worst === 'info'
      ? `Meets today's rule. ${findings[0].message}`
      : findings.find((f) => f.severity === worst)!.message
  return { ruleId: rule, state: 'finding', reason, findings }
}

function evaluateAndroid(facts: RepoFacts, rows: readonly StorePolicyRow[], now: Date): DetectorResult {
  const rule: PolicyRule = 'play_target_sdk_behind'
  if (!facts.hasAndroid) return { ruleId: rule, state: 'ok', reason: 'No Android build in this repo, so the Google Play rule does not apply.', findings: [] }
  const active = inForce(rows, rule, now).filter((r) => r.kind === 'target_sdk')
  if (active.length === 0) return { ruleId: rule, state: 'unknown', reason: 'No Google Play target SDK rule is in force in the policy table.', findings: [] }
  if (active.some((r) => isStale(r, now))) return staleResult(rule, active)
  const sdk = facts.androidTargetSdk
  if (sdk == null) {
    return { ruleId: rule, state: 'unknown', reason: 'Mushi could not read the Android target SDK from the repo, so it could not check the Google Play rule.', findings: [] }
  }

  const updates = active.find((r) => r.audience === 'updates') ?? null
  const existing = active.find((r) => r.audience === 'existing') ?? null
  const where = facts.androidTargetSdkSource ?? ANDROID_FIX_FILE
  const findings: RadarFinding[] = []
  const target = facts.androidTargetSdkSource

  if (existing && sdk < existing.requirement) {
    findings.push({
      ruleId: rule,
      severity: 'error',
      message: `The Android app targets API ${sdk}. Google Play hides apps below API ${existing.requirement} from new users and refuses updates below API ${updates?.requirement ?? existing.requirement}.`,
      target,
      filePath: target,
      fix: `Set targetSdkVersion = ${updates?.requirement ?? existing.requirement} in ${where}, rebuild, test on an Android ${updates?.requirement ?? existing.requirement} device, and ship it in the next store batch.`,
      evidence: { targetSdk: sdk, required: updates?.requirement ?? existing.requirement, policy: [existing.id, updates?.id].filter(Boolean), source: existing.sourceUrl },
    })
  } else if (updates && sdk < updates.requirement) {
    findings.push({
      ruleId: rule,
      severity: 'warn',
      message: `The Android app targets API ${sdk}. Since ${updates.effectiveFrom}, Google Play refuses new apps and updates below API ${updates.requirement}, unless you asked for an extension to 2026-11-01.`,
      target,
      filePath: target,
      fix: `Set targetSdkVersion = ${updates.requirement} in ${where}, rebuild, and test on an Android ${updates.requirement} device before the next update.`,
      evidence: { targetSdk: sdk, required: updates.requirement, policy: updates.id, source: updates.sourceUrl },
    })
  }

  for (const r of upcoming(rows, rule, now)) {
    if (r.kind !== 'target_sdk' || sdk >= r.requirement) continue
    findings.push({
      ruleId: rule,
      severity: 'info',
      message: `Coming on ${r.effectiveFrom}: ${r.appliesTo.toLowerCase()} must target API ${r.requirement}. This app targets API ${sdk}.`,
      target,
      filePath: target,
      fix: `Plan the move to targetSdkVersion = ${r.requirement} in ${where} before ${r.effectiveFrom}.`,
      evidence: { targetSdk: sdk, required: r.requirement, policy: r.id, source: r.sourceUrl },
    })
  }

  return withFindings(rule, findings, `The Android app targets API ${sdk}, which meets Google Play's current rule (API ${updates?.requirement ?? existing?.requirement}).`)
}

function evaluateIos(facts: RepoFacts, rows: readonly StorePolicyRow[], now: Date): DetectorResult {
  const rule: PolicyRule = 'ios_sdk_behind'
  if (!facts.hasIos) return { ruleId: rule, state: 'ok', reason: 'No iOS build in this repo, so the App Store upload rule does not apply.', findings: [] }
  const active = inForce(rows, rule, now)
  if (active.length === 0) return { ruleId: rule, state: 'unknown', reason: 'No App Store upload rule is in force in the policy table.', findings: [] }
  if (active.some((r) => isStale(r, now))) return staleResult(rule, active)
  const xcode = facts.xcodeMajor
  if (xcode == null) {
    return { ruleId: rule, state: 'unknown', reason: 'Mushi could not tell which Xcode builds the iOS app, so it could not check the App Store upload rule.', findings: [] }
  }

  const xcodeRow = active.find((r) => r.kind === 'xcode_major') ?? null
  const deployRow = active.find((r) => r.kind === 'min_deployment_target') ?? null
  const deployment = versionNumber(facts.iosDeploymentTarget)
  const findings: RadarFinding[] = []

  if (xcodeRow && xcode < xcodeRow.requirement) {
    const where = facts.xcodeSource ?? 'the iOS build workflow in .github/workflows/'
    findings.push({
      ruleId: rule,
      severity: 'error',
      message: `The iOS build uses Xcode ${xcode}. Since ${xcodeRow.effectiveFrom}, App Store Connect refuses uploads not built with Xcode ${xcodeRow.requirement} or later.`,
      target: facts.xcodeSource,
      filePath: facts.xcodeSource,
      fix: `In ${where}, pin xcode-version: '${xcodeRow.requirement}' (maxim-lobanov/setup-xcode) or move to a macOS runner image that ships Xcode ${xcodeRow.requirement}, then fix any build errors the new SDK raises.`,
      evidence: { xcodeMajor: xcode, required: xcodeRow.requirement, policy: xcodeRow.id, source: xcodeRow.sourceUrl },
    })
  }
  if (deployRow && deployment != null && deployment < deployRow.requirement) {
    const where = facts.iosDeploymentTargetSource ?? 'ios/App/App.xcodeproj/project.pbxproj'
    findings.push({
      ruleId: rule,
      severity: 'error',
      message: `The iOS app supports iOS ${facts.iosDeploymentTarget}. Since ${deployRow.effectiveFrom}, App Store Connect refuses uploads that target below iOS ${deployRow.requirement}.`,
      target: facts.iosDeploymentTargetSource,
      filePath: facts.iosDeploymentTargetSource,
      fix: `Set IPHONEOS_DEPLOYMENT_TARGET = ${deployRow.requirement}.0 in ${where} (and platform :ios, '${deployRow.requirement}.0' in the Podfile), then rebuild.`,
      evidence: { deploymentTarget: facts.iosDeploymentTarget, required: deployRow.requirement, policy: deployRow.id, source: deployRow.sourceUrl },
    })
  }

  for (const r of upcoming(rows, rule, now)) {
    const have = r.kind === 'xcode_major' ? xcode : r.kind === 'min_deployment_target' ? deployment : null
    if (have == null || have >= r.requirement) continue
    const what = r.kind === 'xcode_major' ? `be built with Xcode ${r.requirement}` : `target iOS ${r.requirement} or later`
    findings.push({
      ruleId: rule,
      severity: 'info',
      message: `Coming on ${r.effectiveFrom}: uploads must ${what}. This app is on ${r.kind === 'xcode_major' ? `Xcode ${xcode}` : `iOS ${facts.iosDeploymentTarget}`}.`,
      target: r.kind === 'xcode_major' ? facts.xcodeSource : facts.iosDeploymentTargetSource,
      filePath: r.kind === 'xcode_major' ? facts.xcodeSource : facts.iosDeploymentTargetSource,
      fix: `Plan the change before ${r.effectiveFrom}.`,
      evidence: { required: r.requirement, policy: r.id, source: r.sourceUrl },
    })
  }

  const deployNote = deployment == null ? ' The minimum iOS version was not found, so only the Xcode version was checked.' : ''
  return withFindings(rule, findings, `The iOS build uses Xcode ${xcode}, which meets the App Store upload rule (Xcode ${xcodeRow?.requirement ?? xcode}).${deployNote}`)
}

/**
 * One result each for `play_target_sdk_behind` and `ios_sdk_behind`.
 * `policies` is injectable for tests; production uses STORE_POLICIES.
 */
export function evaluateStorePolicy(facts: RepoFacts, now: Date, policies: readonly StorePolicyRow[] = STORE_POLICIES): DetectorResult[] {
  return [evaluateAndroid(facts, policies, now), evaluateIos(facts, policies, now)]
}
