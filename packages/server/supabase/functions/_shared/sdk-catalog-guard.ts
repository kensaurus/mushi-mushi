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
