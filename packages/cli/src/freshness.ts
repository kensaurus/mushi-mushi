/**
 * FILE: packages/cli/src/freshness.ts
 * PURPOSE: Best-effort "there's a newer version" hint on wizard start.
 *
 * Matches the pattern used by `create-next-app` and `sentry-wizard`. Users
 * who run `npx mushi-mushi` often hit a cached launcher for days — we
 * politely suggest the upgrade path but never block the wizard.
 *
 * - 2s timeout, fails silent on network errors
 * - Opt out via MUSHI_NO_UPDATE_CHECK=1
 * - Uses a naive semver compare, no extra deps
 */

const REGISTRY = 'https://registry.npmjs.org'
const DEFAULT_TIMEOUT_MS = 2000

export interface FreshnessResult {
  current: string
  latest: string
  isOutdated: boolean
}

export async function checkFreshness(
  packageName: string,
  currentVersion: string,
  opts: { timeoutMs?: number; registry?: string } = {},
): Promise<FreshnessResult | null> {
  if (process.env.MUSHI_NO_UPDATE_CHECK === '1') return null

  const registry = opts.registry ?? REGISTRY
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(
      `${registry}/${encodeURIComponent(packageName)}/latest`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    const latest = typeof body.version === 'string' ? body.version : null
    if (!latest) return null
    return {
      current: currentVersion,
      latest,
      isOutdated: isNewerStableVersion(latest, currentVersion),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Compare two semver strings. Returns true when `latest` is strictly newer
 * than `current` on the major.minor.patch axes AND is not a pre-release
 * (we don't want to nag stable users to upgrade to alpha/beta/rc tags).
 */
export function isNewerStableVersion(latest: string, current: string): boolean {
  const latestCore = stripPreRelease(latest)
  if (hasPreReleaseTag(latest)) return false

  const [la, lb, lc] = parse(latestCore)
  const [ca, cb, cc] = parse(stripPreRelease(current))

  if (la !== ca) return la > ca
  if (lb !== cb) return lb > cb
  return lc > cc
}

function stripPreRelease(version: string): string {
  const idx = version.indexOf('-')
  return idx === -1 ? version : version.slice(0, idx)
}

function hasPreReleaseTag(version: string): boolean {
  return version.includes('-')
}

function parse(version: string): [number, number, number] {
  const parts = version.split('.').map((part) => Number(part))
  return [
    Number.isFinite(parts[0]) ? parts[0] : 0,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ]
}
