/**
 * FILE: _shared/lockfiles/composer.ts
 * PURPOSE: composer.lock → resolved Packagist packages with their dev flag.
 *
 * `packages` are production, `packages-dev` are dev (composer resolves the
 * two lists so that a package needed by both sits in `packages`). Versions
 * lose a leading `v` (`v7.4.0` → `7.4.0`); branch versions (`dev-main`,
 * `2.x-dev`) and anything else that is not an exact numeric version are
 * skipped, as are `path` packages. `direct` is named in composer.json
 * `require` / `require-dev`; platform entries (`php`, `ext-*`, `lib-*`,
 * `composer-*`) are never packages.
 */

import { dedupePackages, type LockfileParse, type Manifests, type ResolvedPackage } from './types.ts'

interface ComposerPackage {
  name?: unknown
  version?: unknown
  dist?: { type?: unknown }
  source?: { type?: unknown }
}

/** 1.2, 1.2.3, 1.2.3.4, with an optional stability suffix (1.2.3-beta1, 1.2.3-RC2, 1.2.3-p1). */
const EXACT_COMPOSER = /^\d+\.\d+(?:\.\d+){0,2}(?:-(?:alpha|beta|a|b|rc|RC|patch|pl|p)\.?\d*)?$/

const PLATFORM = /^(php(-64bit|-ipv6|-zts|-debug)?|hhvm|composer(-plugin-api|-runtime-api)?|ext-.+|lib-.+)$/i

/** Package names that composer.json files beside the lock require. */
function composerDirectNames(manifests: Manifests): Set<string> {
  const names = new Set<string>()
  for (const [path, text] of Object.entries(manifests)) {
    if (!/(^|\/)composer\.json$/.test(path)) continue
    let json: Record<string, unknown>
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    for (const field of ['require', 'require-dev']) {
      const deps = json[field]
      if (!deps || typeof deps !== 'object') continue
      for (const name of Object.keys(deps as Record<string, unknown>)) {
        if (!PLATFORM.test(name)) names.add(name.toLowerCase())
      }
    }
  }
  return names
}

export function parseComposerLock(text: string, manifests: Manifests = {}): LockfileParse {
  const warnings: string[] = []
  let lock: Record<string, unknown>
  try {
    lock = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { kind: 'composer', ecosystem: 'Packagist', packages: [], warnings: ['composer.lock is not valid JSON.'] }
  }
  if (!lock || typeof lock !== 'object' || (!Array.isArray(lock.packages) && !Array.isArray(lock['packages-dev']))) {
    return { kind: 'composer', ecosystem: 'Packagist', packages: [], warnings: ['composer.lock has neither "packages" nor "packages-dev".'] }
  }
  const direct = composerDirectNames(manifests)
  const out: ResolvedPackage[] = []
  let branches = 0
  let local = 0
  for (const [field, dev] of [['packages', false], ['packages-dev', true]] as const) {
    const list = lock[field]
    if (!Array.isArray(list)) continue
    for (const p of list as ComposerPackage[]) {
      if (!p || typeof p.name !== 'string' || typeof p.version !== 'string') continue
      if (p.dist?.type === 'path' || p.source?.type === 'path') {
        local++
        continue
      }
      const version = p.version.replace(/^v/i, '')
      if (!EXACT_COMPOSER.test(version)) {
        branches++
        continue
      }
      const name = p.name.toLowerCase()
      out.push({ ecosystem: 'Packagist', name, version, dev, direct: direct.has(name) })
    }
  }
  if (branches > 0) warnings.push(`${branches} package${branches === 1 ? '' : 's'} on a branch or without an exact version (dev-main, 2.x-dev) skipped.`)
  if (local > 0) warnings.push(`${local} local path package${local === 1 ? '' : 's'} skipped.`)
  return { kind: 'composer', ecosystem: 'Packagist', packages: dedupePackages(out), warnings }
}
