/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-npm-patch.ts
 * PURPOSE: Apply an @mushi-mushi version plan to package-lock.json v2 or v3,
 *          including the legacy dependencies tree and a transitive copy nested
 *          under another @mushi-mushi package.
 */

import { semverSatisfies } from './sdk-upgrade-semver.ts'
import { applyEntry, blockingDep, resolveTargets } from './sdk-upgrade-npm-apply.ts'
import {
  entryViolation,
  installedName,
  metaRanges,
  mushiOnly,
  type LockManifest,
  type Meta,
  type NpmPackument,
} from './sdk-upgrade-npm-lock.ts'

const SCOPE = '@mushi-mushi/'

function writeJson(original: string, value: unknown): string {
  const nl = original.includes('\r\n') ? '\r\n' : '\n'
  const indent = original.match(/\n(\s+)"/)?.[1] ?? '  '
  let text = JSON.stringify(value, null, indent)
  if (nl !== '\n') text = text.replace(/\n/g, nl)
  if (original.endsWith('\n') || original.endsWith('\r\n')) text += nl
  return text
}

function legacyRanges(
  parentName: string | null,
  parent: Record<string, unknown> | null,
  siblings: Record<string, unknown> | null,
  depName: string,
  targets: Map<string, Meta>,
): string[] {
  if (parentName && parent) {
    const meta = targets.get(parentName)
    if (meta) return metaRanges(meta, depName)
    const req = parent.requires
    if (req && typeof req === 'object' && !Array.isArray(req)) {
      const range = (req as Record<string, unknown>)[depName]
      if (typeof range === 'string') return [range]
    }
    return []
  }
  if (!siblings) return []
  const ranges: string[] = []
  for (const [name, raw] of Object.entries(siblings)) {
    if (name === depName || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const nested = entry.dependencies
    if (nested && typeof nested === 'object' && !Array.isArray(nested) && depName in nested) continue
    const meta = targets.get(name)
    if (meta) {
      ranges.push(...metaRanges(meta, depName))
      continue
    }
    const req = entry.requires
    if (req && typeof req === 'object' && !Array.isArray(req)) {
      const range = (req as Record<string, unknown>)[depName]
      if (typeof range === 'string') ranges.push(range)
    }
  }
  return ranges
}

function patchLegacy(
  node: Record<string, unknown>,
  targets: Map<string, Meta>,
  parent: { name: string; entry: Record<string, unknown> } | null,
): { ok: true } | { ok: false; reason: string } {
  for (const [name, raw] of Object.entries(node)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const meta = targets.get(name)
    if (meta && typeof entry.version === 'string' && !entry.version.includes(':')) {
      const ranges = legacyRanges(parent?.name ?? null, parent?.entry ?? null, parent ? null : node, name, targets)
      const nested = parent !== null
      const missed = ranges.filter((range) => !semverSatisfies(meta.version, range))
      if (nested && (ranges.length === 0 || missed.length > 0)) {
        const shown = missed.length ? missed.join(', ') : 'no declared range'
        return { ok: false, reason: `nested ${name}@${meta.version} does not satisfy ${shown} required by ${parent.name}` }
      }
      if (!nested && missed.length > 0) {
        return { ok: false, reason: `nested ${name}@${meta.version} does not satisfy ${missed.join(', ')} required by a hoisted dependent` }
      }
      entry.version = meta.version
      entry.resolved = meta.resolved
      entry.integrity = meta.integrity
      const req = entry.requires
      if (req && typeof req === 'object' && !Array.isArray(req)) {
        const obj = req as Record<string, unknown>
        for (const [dep, range] of Object.entries(mushiOnly(meta.dependencies))) obj[dep] = range
      }
    }
    const child = entry.dependencies
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const result = patchLegacy(child as Record<string, unknown>, targets, { name, entry })
      if (!result.ok) return result
    }
  }
  return { ok: true }
}

export function patchNpmLockfile(
  lockText: string,
  opts: { manifests: LockManifest[]; direct: Record<string, string>; packuments: Record<string, NpmPackument> },
): { ok: true; text: string } | { ok: false; reason: string } {
  let lock: Record<string, unknown>
  try {
    lock = JSON.parse(lockText) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'package-lock.json is not valid JSON' }
  }
  const version = lock.lockfileVersion
  if (version !== 2 && version !== 3) return { ok: false, reason: `lockfileVersion ${String(version)} is not 2 or 3` }
  const packages = lock.packages
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    return { ok: false, reason: 'package-lock.json has no packages map' }
  }
  const pkgs = packages as Record<string, unknown>
  const locked = new Map<string, string[]>()
  for (const [key, entry] of Object.entries(pkgs)) {
    const name = installedName(key, entry)
    const ver = entry && typeof entry === 'object' ? (entry as { version?: unknown }).version : undefined
    if (!name?.startsWith(SCOPE) || typeof ver !== 'string') continue
    const list = locked.get(name) ?? []
    list.push(ver)
    locked.set(name, list)
  }
  const targets = resolveTargets(opts.direct, opts.packuments, locked)
  if ('error' in targets) return { ok: false, reason: targets.error }
  for (const name of targets.keys()) {
    if (![...Object.entries(pkgs)].some(([key, entry]) => installedName(key, entry) === name)) {
      return { ok: false, reason: `no lock entry for ${name}` }
    }
  }
  for (const spec of opts.manifests) {
    const raw = pkgs[spec.lockKey]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    for (const [field, ranges] of Object.entries(spec.ranges)) {
      const section = entry[field]
      if (section && (typeof section !== 'object' || Array.isArray(section))) continue
      entry[field] = { ...(section as Record<string, unknown> | undefined), ...ranges }
    }
    if (spec.overrides) entry.overrides = spec.overrides
  }
  for (const [key, raw] of Object.entries(pkgs)) {
    const name = installedName(key, raw)
    const meta = name ? targets.get(name) : undefined
    if (!name || !meta || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const reason = entryViolation(pkgs, key, name, meta.version, targets)
    if (reason) return { ok: false, reason }
    const missing = blockingDep(pkgs, meta)
    if (missing) return { ok: false, reason: `lock has no entry for ${missing} that satisfies the new manifest` }
  }
  for (const [key, raw] of Object.entries(pkgs)) {
    const name = installedName(key, raw)
    const meta = name ? targets.get(name) : undefined
    if (!name || !meta || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    applyEntry(raw as Record<string, unknown>, meta)
  }
  const legacy = lock.dependencies
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    const result = patchLegacy(legacy as Record<string, unknown>, targets, null)
    if (!result.ok) return result
  }
  return { ok: true, text: writeJson(lockText, lock) }
}
