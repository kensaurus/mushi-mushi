/**
 * Lightweight semver comparison for build-time vs changelog SDK versions.
 * Handles optional leading "v" and ignores pre-release/build metadata suffixes.
 */

function parseVersionParts(version: string): number[] {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? ''
  const parts = core.split('.').map((p) => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
  while (parts.length < 3) parts.push(0)
  return parts
}

/** Returns positive when a > b, negative when a < b, zero when equal. */
export function compareSemver(a: string, b: string): number {
  const pa = parseVersionParts(a)
  const pb = parseVersionParts(b)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Pick the SDK version to display and whether changelog is ahead of the build. */
export function resolveDisplayVersion(
  changelogVersion: string | null,
  buildVersion: string,
): { version: string; isNewer: boolean } {
  if (!changelogVersion) return { version: buildVersion, isNewer: false }
  if (compareSemver(changelogVersion, buildVersion) > 0) {
    return { version: changelogVersion, isNewer: true }
  }
  return { version: buildVersion, isNewer: false }
}
