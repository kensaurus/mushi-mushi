/**
 * FILE: packages/server/supabase/functions/_shared/modernizer-versions.ts
 * PURPOSE: The facts library-modernizer may propose an upgrade on.
 *
 * The modernizer asked an LLM which dependencies were "behind" and stored the
 * version the model named. The model answered from its training data: on
 * tsumagoi it proposed @sentry/react 10.45 → 8.55 and @stripe/react-stripe-js
 * 6.2 → 3.5 (downgrades), plus suggestions like "10.x latest" and
 * "<UNKNOWN>". Now npm's registry decides:
 *
 *   - the suggested version is npm's latest STABLE release, never the model's;
 *   - a proposal exists only when that release is strictly greater than the
 *     lowest version the declared range allows, and outside the range (a range
 *     that already admits it gets it on the next install);
 *   - an unparseable range (workspace:, git, file:, tags) is never proposed.
 *
 * Pure apart from the injected fetch; no Deno globals.
 */

export interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseSemver(raw: string): SemVer | null {
  const m = SEMVER_RE.exec(raw.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  }
}

/** Semver 2.0 precedence: -1, 0, 1. A release outranks its prereleases. */
export function compareSemver(a: SemVer, b: SemVer): number {
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const n = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export interface InstalledRange {
  /** Lowest version the declared spec allows. */
  floor: SemVer
  /** The spec's operator: '^', '~', '=', '>=' . */
  op: '^' | '~' | '=' | '>='
}

/**
 * Parse a package.json dependency spec into its floor version. Accepts
 * `^1.2.3`, `~1.2.3`, `1.2.3`, `=1.2.3`, `>=1.2.3`, and partial `^1.2` /
 * `1.x`-free forms padded with zeros. Anything else — `workspace:*`, `*`,
 * `latest`, git/file/url specs, compound ranges — returns null.
 */
export function parseInstalledRange(spec: string): InstalledRange | null {
  const s = spec.trim()
  const m = /^(\^|~|=|>=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/.exec(s)
  if (!m) return null
  const floor = parseSemver(`${m[2]}.${m[3] ?? '0'}.${m[4] ?? '0'}${m[5] ?? ''}`)
  if (!floor) return null
  return { floor, op: (m[1] as InstalledRange['op'] | undefined) ?? '=' }
}

/** True when `v` is already admitted by the declared range (no upgrade needed). */
export function rangeAdmits(range: InstalledRange, v: SemVer): boolean {
  if (compareSemver(v, range.floor) < 0) return false
  const f = range.floor
  switch (range.op) {
    case '>=':
      return true
    case '=':
      return compareSemver(v, f) === 0
    case '~':
      return v.major === f.major && v.minor === f.minor
    case '^':
      if (f.major > 0) return v.major === f.major
      if (f.minor > 0) return v.major === 0 && v.minor === f.minor
      return v.major === 0 && v.minor === 0 && v.patch === f.patch
  }
}

/**
 * The version to propose for `spec`, or null when no upgrade should be filed:
 * latest stable must be strictly greater than the range's floor and outside
 * the range.
 */
export function upgradeTarget(spec: string, latestStable: string | null): string | null {
  if (!latestStable) return null
  const range = parseInstalledRange(spec)
  const latest = parseSemver(latestStable)
  if (!range || !latest || latest.prerelease.length > 0) return null
  if (compareSemver(latest, range.floor) <= 0) return null
  if (rangeAdmits(range, latest)) return null
  return latestStable
}

const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/**
 * npm's latest STABLE version of `name`, or null when it cannot be known
 * (unknown package, private registry, network). `dist-tags.latest` is used
 * when it is a release; if it is a prerelease, the highest release wins.
 */
export async function npmLatestStable(name: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  return (await npmLatestStableInfo(name, fetchImpl))?.version ?? null
}

/**
 * npm's latest stable version of `name` and that release's peerDependencies,
 * read from the same abbreviated registry document.
 */
export async function npmLatestStableInfo(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ version: string; peers: Record<string, string> } | null> {
  if (!NPM_NAME_RE.test(name)) return null
  let res: Response
  try {
    res = await fetchImpl(`https://registry.npmjs.org/${name.replace(/\//g, '%2f')}`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as
    | { 'dist-tags'?: { latest?: string }; versions?: Record<string, { peerDependencies?: Record<string, string> }> }
    | null
  const withPeers = (version: string) => ({ version, peers: body?.versions?.[version]?.peerDependencies ?? {} })
  const tagged = body?.['dist-tags']?.latest
  const taggedSemver = tagged ? parseSemver(tagged) : null
  if (taggedSemver && taggedSemver.prerelease.length === 0) return withPeers(tagged!)
  let best: { raw: string; v: SemVer } | null = null
  for (const raw of Object.keys(body?.versions ?? {})) {
    const v = parseSemver(raw)
    if (!v || v.prerelease.length > 0) continue
    if (!best || compareSemver(v, best.v) > 0) best = { raw, v }
  }
  return best ? withPeers(best.raw) : null
}

/** True when `version` satisfies any `||` part of a peer range; unparseable parts never block. */
function peerRangeAdmits(range: string, version: string): boolean {
  const v = parseSemver(version)
  if (!v) return true
  for (const part of range.split('||')) {
    const r = parseInstalledRange(part)
    if (!r || rangeAdmits(r, v)) return true
  }
  return false
}

/**
 * Split candidates into upgrades that can land now and ones another installed
 * package forbids: when a dependency's LATEST release still pins the
 * candidate to a range its target falls outside (@sentry/capacitor 4.4.0
 * requires @sentry/react 10.69.0, so @sentry/react 11 would break it),
 * upgrading anything cannot make the target installable yet.
 */
export function splitPeerBlocked(
  candidates: UpgradeCandidate[],
  peersByName: Map<string, Record<string, string>>,
): { ready: UpgradeCandidate[]; blocked: Array<UpgradeCandidate & { blockedBy: string; requires: string }> } {
  const ready: UpgradeCandidate[] = []
  const blocked: Array<UpgradeCandidate & { blockedBy: string; requires: string }> = []
  for (const c of candidates) {
    let hit: { blockedBy: string; requires: string } | null = null
    for (const [dep, peers] of peersByName) {
      if (dep === c.name) continue
      const range = peers[c.name]
      if (range && !peerRangeAdmits(range, c.latest)) {
        hit = { blockedBy: dep, requires: range }
        break
      }
    }
    if (hit) blocked.push({ ...c, ...hit })
    else ready.push(c)
  }
  return { ready, blocked }
}

export interface UpgradeCandidate {
  name: string
  /** The spec as declared in package.json, e.g. "^10.45.0". */
  installed: string
  /** npm's latest stable, strictly newer and outside the range. */
  latest: string
}

/** Dependencies with a real upgrade, given npm's latest stable for each. */
export function upgradeCandidates(
  deps: Array<{ name: string; version: string }>,
  latestByName: Map<string, string | null>,
): UpgradeCandidate[] {
  const out: UpgradeCandidate[] = []
  for (const d of deps) {
    const target = upgradeTarget(d.version, latestByName.get(d.name) ?? null)
    if (target) out.push({ name: d.name, installed: d.version, latest: target })
  }
  return out
}

/**
 * Keep only model findings about a real candidate, one per package, with the
 * versions taken from the manifest and the registry, never from the model.
 */
export function bindFindingsToRegistry<F extends { name: string; currentVersion: string; suggestedVersion: string }>(
  findings: F[],
  candidates: UpgradeCandidate[],
): F[] {
  const byName = new Map(candidates.map((c) => [c.name, c]))
  const seen = new Set<string>()
  const out: F[] = []
  for (const f of findings) {
    const c = byName.get(f.name)
    if (!c || seen.has(f.name)) continue
    seen.add(f.name)
    out.push({ ...f, currentVersion: c.installed, suggestedVersion: c.latest })
  }
  return out
}

/**
 * Expo pins the versions of the native modules an SDK release supports, in
 * `expo/bundledNativeModules.json`. Upgrading past the pin is a native change
 * Expo has not shipped yet (async-storage 3.x on Expo 57, which pins 2.2.0),
 * so `npx expo install` is the upgrade path, not a version bump.
 * Returns null when the pin list cannot be read; nothing is held then.
 */
export async function expoBundledModules(
  expoSpec: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string> | null> {
  const range = parseInstalledRange(expoSpec)
  if (!range) return null
  const v = range.floor
  const version = `${v.major}.${v.minor}.${v.patch}`
  try {
    const res = await fetchImpl(`https://cdn.jsdelivr.net/npm/expo@${version}/bundledNativeModules.json`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, string>) : null
  } catch {
    return null
  }
}

/** Hold back the candidates Expo's SDK pins; the rest can be proposed. */
export function splitExpoPinned(
  candidates: UpgradeCandidate[],
  pins: Record<string, string> | null,
): { ready: UpgradeCandidate[]; pinned: Array<UpgradeCandidate & { expoPin: string }> } {
  if (!pins) return { ready: candidates, pinned: [] }
  const ready: UpgradeCandidate[] = []
  const pinned: Array<UpgradeCandidate & { expoPin: string }> = []
  for (const c of candidates) {
    const pin = pins[c.name]
    if (typeof pin === 'string') pinned.push({ ...c, expoPin: pin })
    else ready.push(c)
  }
  return { ready, pinned }
}
