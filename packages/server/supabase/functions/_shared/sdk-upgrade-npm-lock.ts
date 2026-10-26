/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-npm-lock.ts
 * PURPOSE: Choose @mushi-mushi versions for an npm lock edit and reject a copy
 *          whose requirers do not accept it (ADR 0043, proposed). ADR 0019
 *          still owns hosts that have the lockfile workflow.
 */

import { semverSatisfies } from './sdk-upgrade-semver.ts'

const SCOPE = '@mushi-mushi/'
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

export interface NpmPackument {
  latest: string | null
  versions: Record<string, {
    version?: string
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    dist?: { tarball?: string; integrity?: string }
  }>
}

export interface Meta {
  version: string
  resolved: string
  integrity: string
  dependencies: Record<string, string>
  optionalDependencies: Record<string, string>
  peerDependencies: Record<string, string>
}

export interface LockManifest {
  lockKey: string
  ranges: Record<string, Record<string, string>>
  overrides?: Record<string, unknown>
}

export type Entry = Record<string, unknown>
export type Targets = Map<string, Meta>

export function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

export function mushiOnly(deps: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(deps)) if (key.startsWith(SCOPE)) out[key] = value
  return out
}

export function installedName(key: string, entry: unknown): string | null {
  const at = key.lastIndexOf('node_modules/')
  if (at < 0 || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  if ((entry as { link?: unknown }).link === true) return null
  const name = key.slice(at + 'node_modules/'.length)
  const alias = (entry as { name?: unknown }).name
  if (typeof alias === 'string' && alias !== name) return null
  return name || null
}

export function metaOf(pack: NpmPackument | undefined, version: string): Meta | null {
  const row = pack?.versions?.[version]
  const tarball = row?.dist?.tarball
  const integrity = row?.dist?.integrity
  if (!row || !tarball?.startsWith('https://') || !tarball.includes(`-${version}.tgz`)) return null
  if (!integrity?.startsWith('sha') || (row.version && row.version !== version)) return null
  return {
    version,
    resolved: tarball,
    integrity,
    dependencies: stringMap(row.dependencies),
    optionalDependencies: stringMap(row.optionalDependencies),
    peerDependencies: stringMap(row.peerDependencies),
  }
}

export function metaRanges(meta: Meta, depName: string): string[] {
  const ranges: string[] = []
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const range = meta[field][depName]
    if (range) ranges.push(range)
  }
  return ranges
}

function declaredRanges(entry: Entry, depName: string): string[] {
  const ranges: string[] = []
  for (const field of DEP_FIELDS) {
    const range = stringMap(entry[field])[depName]
    if (range) ranges.push(range)
  }
  return ranges
}

/** `node_modules/a` → `''`. `node_modules/a/node_modules/b` → `node_modules/a`. */
function nodeParent(key: string): string | null {
  if (!key) return null
  const at = key.lastIndexOf('/node_modules/')
  if (at >= 0) return key.slice(0, at)
  return key.startsWith('node_modules/') ? '' : null
}

function resolvesTo(pkgs: Record<string, unknown>, fromKey: string, name: string): string | null {
  let cursor: string | null = fromKey
  const seen = new Set<string>()
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const candidate = cursor === '' ? `node_modules/${name}` : `${cursor}/node_modules/${name}`
    if (Object.prototype.hasOwnProperty.call(pkgs, candidate)) return candidate
    cursor = nodeParent(cursor)
  }
  return null
}

function rangesFrom(key: string, entry: Entry, depName: string, targets: Targets): string[] {
  if (key !== '') {
    const name = installedName(key, entry)
    const meta = name ? targets.get(name) : undefined
    if (meta) return metaRanges(meta, depName)
  }
  return declaredRanges(entry, depName)
}

function requirerRanges(pkgs: Record<string, unknown>, key: string, name: string, targets: Targets): string[] {
  const ranges: string[] = []
  for (const [fromKey, raw] of Object.entries(pkgs)) {
    if (fromKey === key || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const declared = rangesFrom(fromKey, raw as Entry, name, targets)
    if (declared.length === 0) continue
    if (resolvesTo(pkgs, fromKey, name) === key) ranges.push(...declared)
  }
  return ranges
}

function rangeRefusal(name: string, version: string, ranges: string[], label: string): string | null {
  if (ranges.length === 0) {
    return `nested ${name}@${version} does not satisfy no declared range required by ${label}`
  }
  const missed = ranges.filter((range) => !semverSatisfies(version, range))
  if (missed.length === 0) return null
  return `nested ${name}@${version} does not satisfy ${missed.join(', ')} required by ${label}`
}

/** Hoisted copies with no requirer are still updated. Nested copies need a range. */
export function entryViolation(
  pkgs: Record<string, unknown>,
  key: string,
  name: string,
  version: string,
  targets: Targets,
): string | null {
  const parent = nodeParent(key)
  const nested = parent !== null && parent !== ''
  const ranges = requirerRanges(pkgs, key, name, targets)
  if (!nested && ranges.length === 0) return null
  return rangeRefusal(name, version, ranges, nested ? parent! : 'a hoisted dependent')
}
