/**
 * FILE: packages/server/supabase/functions/_shared/sdk-version-compare.ts
 * PURPOSE: Semver compare for SDK catalogue freshness — avoids marking
 *          v1.7.x projects "outdated" against a stale v0.9.0 catalogue row.
 */

export type SdkFreshnessStatus = 'up-to-date' | 'outdated' | 'deprecated' | 'unknown'

export function stripPreRelease(version: string): string {
  // Strip at the first of `-` (pre-release) or `+` (build metadata):
  // "1.7.5+build.1" must parse as 1.7.5, not 1.7.0.
  const idx = version.search(/[-+]/)
  return idx === -1 ? version : version.slice(0, idx)
}

function parseCore(version: string): [number, number, number] {
  const parts = stripPreRelease(version).split('.').map((part) => Number(part))
  return [
    Number.isFinite(parts[0]) ? parts[0] : 0,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ]
}

/** Negative = a older than b, 0 = equal, positive = a newer than b. */
export function compareSemver(a: string, b: string): number {
  const [aa, ab, ac] = parseCore(a)
  const [ba, bb, bc] = parseCore(b)
  if (aa !== ba) return aa - ba
  if (ab !== bb) return ab - bb
  return ac - bc
}

export function resolveSdkFreshnessStatus(input: {
  sdkPackage: string | null
  sdkVersion: string | null
  catalogVersion: string | null
  catalogDeprecated: boolean
}): SdkFreshnessStatus {
  const { sdkPackage, sdkVersion, catalogVersion, catalogDeprecated } = input
  if (!sdkPackage || !sdkVersion || !catalogVersion) return 'unknown'

  if (catalogDeprecated && compareSemver(sdkVersion, catalogVersion) <= 0) {
    return 'deprecated'
  }

  const cmp = compareSemver(sdkVersion, catalogVersion)
  if (cmp >= 0) return 'up-to-date'
  return 'outdated'
}
