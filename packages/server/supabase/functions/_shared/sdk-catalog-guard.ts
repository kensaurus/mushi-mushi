/**
 * FILE: packages/server/supabase/functions/_shared/sdk-catalog-guard.ts
 * PURPOSE: Sanity checks before upserting npm registry versions into sdk_versions.
 */

import { compareSemver } from './sdk-version-compare.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('sdk-catalog-guard')

function parseMajor(version: string): number {
  const core = version.split('-')[0].split('+')[0]
  const major = Number(core.split('.')[0])
  return Number.isFinite(major) ? major : 0
}

/**
 * Reject catalogue rows that jump a full major (or more) ahead of the stored
 * max — e.g. a 0.x package suddenly reporting 1.x from the npm registry is the
 * classic poison-row / takeover pattern, so quarantine any major-version jump
 * for human review. Same-major patch/minor bumps pass through untouched.
 */
export function shouldQuarantineCatalogVersion(
  packageName: string,
  candidateVersion: string,
  existingMaxVersion: string | null,
): boolean {
  if (!existingMaxVersion) return false
  if (compareSemver(candidateVersion, existingMaxVersion) <= 0) return false
  const majorJump = parseMajor(candidateVersion) - parseMajor(existingMaxVersion)
  if (majorJump >= 1) {
    log.warn('sdk-catalog-guard: quarantining suspicious major jump', {
      package: packageName,
      candidateVersion,
      existingMaxVersion,
      majorJump,
    })
    return true
  }
  return false
}

/** Upper bound on `expected` entries read from a request body. */
const MAX_EXPECTED_ENTRIES = 50
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export interface ExpectedVersion {
  name: string
  version: string
}

export interface CatalogHint {
  /** Well-formed entries for packages the catalogue tracks. */
  expected: ExpectedVersion[]
  /** Well-formed `name@version` entries for packages it does not track. */
  ignored: string[]
}

/**
 * Read the optional `{ expected: [{ name, version }] }` hint release.yml
 * sends after a publish. It is compare-only: nothing from it is ever written
 * to sdk_versions. Malformed input yields an empty hint, never an error, so a
 * bad body can't fail the pg_cron run.
 */
export function parseCatalogHint(body: unknown, trackedPackages: readonly string[]): CatalogHint {
  const hint: CatalogHint = { expected: [], ignored: [] }
  const list = (body as { expected?: unknown } | null)?.expected
  if (!Array.isArray(list)) return hint
  const tracked = new Set(trackedPackages)
  for (const entry of list.slice(0, MAX_EXPECTED_ENTRIES)) {
    const { name, version } = (entry ?? {}) as { name?: unknown; version?: unknown }
    if (typeof name !== 'string' || typeof version !== 'string' || !SEMVER_RE.test(version)) continue
    if (tracked.has(name)) hint.expected.push({ name, version })
    else hint.ignored.push(`${name}@${version}`)
  }
  return hint
}

/**
 * `name@version` for every expected version npm's `latest` has not reached
 * yet (or npm did not answer for). A quarantined version that npm does serve
 * is not stale: retrying will not change it.
 */
export function findStaleExpected(
  expected: readonly ExpectedVersion[],
  latestVersions: Readonly<Record<string, string>>,
): string[] {
  return expected
    .filter(({ name, version }) => {
      const latest = latestVersions[name]
      return !latest || compareSemver(latest, version) < 0
    })
    .map(({ name, version }) => `${name}@${version}`)
}
