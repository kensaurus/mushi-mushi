/**
 * FILE: apps/admin/src/lib/sdkVersionCompare.ts
 * PURPOSE: Client-side semver helpers for SDK freshness chips — mirrors
 *          packages/server/.../sdk-version-compare.ts so the UI never
 *          shows "v1.7.7 → v0.9.0" when the catalogue is stale.
 */

import type { SdkStatus } from '../components/SdkVersionBadge'

export type SdkDisplayKind =
  | 'up-to-date'
  | 'upgrade-available'
  | 'catalog-ahead'
  | 'deprecated'
  | 'unknown'

function stripPreRelease(version: string): string {
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

export interface SdkDisplayResolution {
  kind: SdkDisplayKind
  /** True when observed > catalogue — catalogue row needs a publish upsert. */
  catalogStale: boolean
  /** Set only when a real upgrade exists (catalog > observed). */
  upgradeTarget: string | null
}

export function resolveSdkDisplay(input: {
  observedVersion: string | null
  latestVersion: string | null
  backendStatus: SdkStatus | undefined
  deprecated?: boolean
}): SdkDisplayResolution {
  const { observedVersion, latestVersion, backendStatus, deprecated } = input
  if (!observedVersion || backendStatus === 'unknown' || !latestVersion) {
    return { kind: 'unknown', catalogStale: false, upgradeTarget: null }
  }

  if (deprecated || backendStatus === 'deprecated') {
    return { kind: 'deprecated', catalogStale: false, upgradeTarget: latestVersion }
  }

  const cmp = compareSemver(observedVersion, latestVersion)
  if (cmp > 0) {
    return { kind: 'catalog-ahead', catalogStale: true, upgradeTarget: null }
  }
  if (cmp === 0) {
    return { kind: 'up-to-date', catalogStale: false, upgradeTarget: null }
  }
  return { kind: 'upgrade-available', catalogStale: false, upgradeTarget: latestVersion }
}
