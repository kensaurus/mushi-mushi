/**
 * FILE: packages/server/supabase/functions/_shared/radar/repo-scan.ts
 * PURPOSE: Pure readers over repo file texts for the radar (Plan 020 §4.2):
 *          - extractRepoFacts: the Android target SDK, the Xcode the iOS
 *            build uses and the iOS deployment target, each with the file it
 *            came from (input of store-policy.ts);
 *          - scanStorageSqlDelete: `storage_sql_delete`, a delete of storage
 *            rows through SQL, which orphans the file in the bucket.
 *
 * No I/O. The server reads only REPO_SCAN_PATHS at a pinned SHA; the host's
 * CI runs scanStorageSqlDelete over the whole repo (Mushi never clones).
 */

import type { RepoFacts } from './types.ts'
import { isRepoScanPath, normalizePath, REPO_SCAN_PATHS, scanStorageSqlDelete, uncommentedLines } from './repo-scan-core.ts'

export { isRepoScanPath, REPO_SCAN_PATHS, scanStorageSqlDelete }

/**
 * Default Xcode on GitHub-hosted macOS runner images, as of 2026-10-02 —
 * verify against https://github.com/actions/runner-images before relying on
 * it. Only used when no workflow pins an Xcode version explicitly.
 * `macos-latest` moves, so it is deliberately not mapped.
 */
export const RUNNER_IMAGE_XCODE: Readonly<Record<string, number>> = {
  '13': 15,
  '14': 15,
  '15': 16,
  '26': 26,
}

// ── Android ──────────────────────────────────────────────────────────────────

/** `targetSdkVersion = 35` / `targetSdkVersion 35` / `targetSdk = 35` / `targetSdk 35`. */
const GRADLE_TARGET_NUMBER = /\btargetSdk(?:Version)?\s*(?:=\s*)?(\d{2})\b/
/** `targetSdkVersion rootProject.ext.targetSdkVersion` and friends. */
const GRADLE_TARGET_REF = /\btargetSdk(?:Version)?\s*(?:=\s*)?(?:rootProject\.ext\.|project\.ext\.|ext\.)?(targetSdkVersion|targetSdk)\b(?!\s*=)/

function gradleNumber(text: string | undefined): number | null {
  if (!text) return null
  for (const line of uncommentedLines(text, 'gradle')) {
    const m = GRADLE_TARGET_NUMBER.exec(line)
    if (m) return Number(m[1])
  }
  return null
}

function gradleReferencesVariable(text: string | undefined): boolean {
  if (!text) return false
  return uncommentedLines(text, 'gradle').some((l) => GRADLE_TARGET_REF.test(l) && !GRADLE_TARGET_NUMBER.test(l))
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function expoConfig(files: Record<string, string>): { path: string; expo: Record<string, unknown> } | null {
  for (const path of ['app.json', 'app.config.json']) {
    const json = parseJson(files[path])
    if (!json) continue
    const expo = asRecord(json.expo) ?? (path === 'app.config.json' ? json : null)
    if (expo) return { path, expo }
  }
  return null
}

/** The `expo-build-properties` plugin's options, if the plugin is configured. */
function expoBuildProperties(expo: Record<string, unknown>): Record<string, unknown> | null {
  const plugins = Array.isArray(expo.plugins) ? expo.plugins : []
  for (const p of plugins) {
    if (Array.isArray(p) && p[0] === 'expo-build-properties') return asRecord(p[1])
  }
  return null
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  return null
}

function androidTargetSdk(files: Record<string, string>, expo: { path: string; expo: Record<string, unknown> } | null): { sdk: number | null; source: string | null } {
  for (const path of ['android/app/build.gradle', 'android/app/build.gradle.kts']) {
    const n = gradleNumber(files[path])
    if (n != null) return { sdk: n, source: path }
  }
  // Capacitor and React Native keep the number in a root ext block that
  // app/build.gradle references; also read it when app/build.gradle is absent.
  const refers = gradleReferencesVariable(files['android/app/build.gradle']) || gradleReferencesVariable(files['android/app/build.gradle.kts'])
  for (const path of ['android/variables.gradle', 'android/build.gradle']) {
    const n = gradleNumber(files[path])
    if (n != null && (refers || !files['android/app/build.gradle'])) return { sdk: n, source: path }
  }
  if (expo) {
    const android = asRecord(expo.expo.android)
    const direct = toNumber(android?.targetSdkVersion)
    if (direct != null) return { sdk: direct, source: expo.path }
    const props = asRecord(expoBuildProperties(expo.expo)?.android)
    const viaPlugin = toNumber(props?.targetSdkVersion)
    if (viaPlugin != null) return { sdk: viaPlugin, source: expo.path }
  }
  return { sdk: null, source: null }
}

// ── iOS ──────────────────────────────────────────────────────────────────────

const XCODE_PINS: RegExp[] = [
  /\bxcode-version\s*:\s*['"]?(\d+)(?:\.\d+)*['"]?/i,
  /\bDEVELOPER_DIR\s*[:=]\s*['"]?\/Applications\/Xcode[_-]?(\d+)/,
  /\bxcode-select\s+(?:-s|--switch)\s+['"]?\/Applications\/Xcode[_-]?(\d+)/,
]
const RUNNER_IMAGE = /\bruns-on\s*:\s*\[?\s*['"]?macos-(\d+)\b/i
/** EAS build images name their Xcode: `macos-sequoia-15.5-xcode-16.4`. */
const EAS_IMAGE_XCODE = /xcode-(\d+)/i

function xcodeMajor(files: Record<string, string>): { major: number | null; source: string | null } {
  const workflows = Object.keys(files).filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).sort()
  let pinned: { major: number; source: string } | null = null
  let image: { major: number; source: string } | null = null
  for (const path of workflows) {
    for (const line of uncommentedLines(files[path], 'yaml')) {
      for (const re of XCODE_PINS) {
        const m = re.exec(line)
        if (m && (!pinned || Number(m[1]) > pinned.major)) pinned = { major: Number(m[1]), source: path }
      }
      const r = RUNNER_IMAGE.exec(line)
      const mapped = r ? RUNNER_IMAGE_XCODE[r[1]] : undefined
      if (mapped != null && (!image || mapped > image.major)) image = { major: mapped, source: path }
    }
  }
  if (pinned) return { major: pinned.major, source: pinned.source }
  // EAS cloud builds: the image named in eas.json, when it is not "latest".
  const eas = parseJson(files['eas.json'])
  const builds = asRecord(eas?.build)
  if (builds) {
    let best: number | null = null
    for (const profile of Object.values(builds)) {
      const ios = asRecord(asRecord(profile)?.ios)
      const m = typeof ios?.image === 'string' ? EAS_IMAGE_XCODE.exec(ios.image) : null
      if (m && (best == null || Number(m[1]) > best)) best = Number(m[1])
    }
    if (best != null) return { major: best, source: 'eas.json' }
  }
  if (image) return { major: image.major, source: image.source }
  return { major: null, source: null }
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function iosDeploymentTarget(files: Record<string, string>, expo: { path: string; expo: Record<string, unknown> } | null): { target: string | null; source: string | null } {
  const projects = Object.keys(files).filter((p) => /^ios\/(?:[^/]+\/)?[^/]+\.xcodeproj\/project\.pbxproj$/.test(p)).sort()
  let min: { target: string; source: string } | null = null
  for (const path of projects) {
    for (const m of files[path].matchAll(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*"?(\d+(?:\.\d+)*)"?\s*;/g)) {
      if (!min || compareVersion(m[1], min.target) < 0) min = { target: m[1], source: path }
    }
  }
  if (min) return min
  for (const path of ['ios/App/Podfile', 'ios/Podfile']) {
    for (const line of uncommentedLines(files[path], 'ruby')) {
      const m = /^\s*platform\s+:ios\s*,\s*['"](\d+(?:\.\d+)*)['"]/.exec(line)
      if (m) return { target: m[1], source: path }
    }
  }
  if (expo) {
    const ios = asRecord(expoBuildProperties(expo.expo)?.ios)
    if (typeof ios?.deploymentTarget === 'string') return { target: ios.deploymentTarget, source: expo.path }
  }
  return { target: null, source: null }
}

// ── facts ────────────────────────────────────────────────────────────────────

/**
 * Read the store-policy facts from repo file texts keyed by repo path. A
 * fact that is not found is null (the policy rule then reads `unknown`),
 * never a guess.
 */
export function extractRepoFacts(input: Record<string, string>): RepoFacts {
  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) files[normalizePath(k)] = v
  const paths = Object.keys(files)
  const expo = expoConfig(files)
  const expoPlatforms = expo && Array.isArray(expo.expo.platforms) ? (expo.expo.platforms as unknown[]).map(String) : null

  const hasAndroid = paths.some((p) => p.startsWith('android/')) || (expo != null && (expoPlatforms == null || expoPlatforms.includes('android')))
  const hasIos = paths.some((p) => p.startsWith('ios/')) || (expo != null && (expoPlatforms == null || expoPlatforms.includes('ios')))

  const android = androidTargetSdk(files, expo)
  const xcode = xcodeMajor(files)
  const deploy = iosDeploymentTarget(files, expo)
  return {
    androidTargetSdk: android.sdk,
    androidTargetSdkSource: android.source,
    xcodeMajor: xcode.major,
    xcodeSource: xcode.source,
    iosDeploymentTarget: deploy.target,
    iosDeploymentTargetSource: deploy.source,
    hasAndroid,
    hasIos,
  }
}
