/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-npm-apply.ts
 * PURPOSE: Pick the @mushi-mushi versions for a lock edit and write version,
 *          resolved, and integrity onto one entry. Prereleases are eligible
 *          only when every range allows that prerelease.
 */

import { cmpSemVer, semverSatisfies } from './sdk-upgrade-semver.ts'
import {
  EXACT_VERSION,
  installedName,
  metaOf,
  mushiOnly,
  stringMap,
  type Entry,
  type Meta,
  type NpmPackument,
  type Targets,
} from './sdk-upgrade-npm-lock.ts'

const SCOPE = '@mushi-mushi/'

function pickTransitive(ranges: string[], pack: NpmPackument | undefined, locked: string[]): string | null {
  if (!pack) return null
  const ok = (version: string) =>
    EXACT_VERSION.test(version) &&
    Boolean(pack.versions[version]) &&
    ranges.every((range) => semverSatisfies(version, range))
  const kept = locked.filter(ok).sort((a, b) => cmpSemVer(b, a))
  if (kept[0]) return kept[0]
  if (pack.latest && ok(pack.latest)) return pack.latest
  let best: string | null = null
  for (const version of Object.keys(pack.versions)) {
    if (!ok(version)) continue
    if (!best || cmpSemVer(version, best) > 0) best = version
  }
  return best
}

/** Exact direct versions, then the @mushi-mushi packages those versions require. */
export function resolveTargets(
  direct: Record<string, string>,
  packs: Record<string, NpmPackument>,
  locked: Map<string, string[]>,
): Targets | { error: string } {
  const chosen = new Map<string, string>()
  for (const [name, version] of Object.entries(direct)) {
    if (EXACT_VERSION.test(version)) chosen.set(name, version)
  }
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    const ranges = new Map<string, string[]>()
    for (const [name, version] of chosen) {
      const meta = metaOf(packs[name], version)
      if (!meta) return { error: `no registry metadata for ${name}@${version}` }
      for (const [dep, range] of Object.entries(mushiOnly(meta.dependencies))) {
        const list = ranges.get(dep) ?? []
        if (!list.includes(range)) list.push(range)
        ranges.set(dep, list)
      }
    }
    for (const [dep, list] of ranges) {
      if (direct[dep] && EXACT_VERSION.test(direct[dep])) continue
      const picked = pickTransitive(list, packs[dep], locked.get(dep) ?? [])
      if (!picked) return { error: `no version of ${dep} satisfies ${list.join(' ')}` }
      if (chosen.get(dep) !== picked) {
        chosen.set(dep, picked)
        changed = true
      }
    }
    if (!changed) break
  }
  const targets: Targets = new Map()
  for (const [name, version] of chosen) {
    const meta = metaOf(packs[name], version)
    if (!meta) return { error: `no registry metadata for ${name}@${version}` }
    targets.set(name, meta)
  }
  return targets
}

/** A production dependency the lock cannot already satisfy. @mushi-mushi deps are rewritten. */
export function blockingDep(pkgs: Record<string, unknown>, meta: Meta): string | null {
  for (const [dep, range] of Object.entries(meta.dependencies)) {
    if (dep.startsWith(SCOPE)) continue
    const versions: string[] = []
    for (const [key, entry] of Object.entries(pkgs)) {
      if (installedName(key, entry) !== dep || !entry || typeof entry !== 'object') continue
      const ver = (entry as { version?: unknown }).version
      if (typeof ver === 'string') versions.push(ver)
    }
    if (!versions.some((ver) => semverSatisfies(ver, range))) return dep
  }
  return null
}

export function applyEntry(entry: Entry, meta: Meta): void {
  entry.version = meta.version
  entry.resolved = meta.resolved
  entry.integrity = meta.integrity
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const next = syncMushiField(entry[field], mushiOnly(meta[field]))
    if (next === 'omit') delete entry[field]
    else if (next !== 'keep') entry[field] = next
  }
}

function syncMushiField(section: unknown, mushi: Record<string, string>): 'keep' | 'omit' | Record<string, string> {
  if (section !== undefined && (typeof section !== 'object' || section === null || Array.isArray(section))) return 'keep'
  const base = stringMap(section)
  let changed = false
  for (const key of Object.keys(base)) {
    if (!key.startsWith(SCOPE) || key in mushi) continue
    delete base[key]
    changed = true
  }
  for (const [key, range] of Object.entries(mushi)) {
    if (base[key] === range) continue
    base[key] = range
    changed = true
  }
  if (!changed) return 'keep'
  return Object.keys(base).length ? base : 'omit'
}
