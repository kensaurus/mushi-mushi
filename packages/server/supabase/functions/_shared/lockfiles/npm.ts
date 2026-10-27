/**
 * FILE: _shared/lockfiles/npm.ts
 * PURPOSE: package-lock.json / npm-shrinkwrap.json (lockfileVersion 1, 2, 3)
 *          → resolved npm packages with their dev flag.
 *
 * v2/v3 read the flat `packages` map: the name is the last `node_modules/`
 * segment (or the entry's `name` for an alias), `dev: true` marks a
 * dev-only package. `devOptional` is NOT dev: npm sets it on a package that
 * a production dependency needs optionally. Workspace links are skipped, and
 * so are git and local entries: they keep a semver `version` but their
 * `resolved` is not an http(s) tarball, so they are not the registry package.
 * v1 walks the nested `dependencies` tree.
 */

import { dedupePackages, EXACT_SEMVER, npmManifestDeps, type LockfileParse, type Manifests, type ResolvedPackage } from './types.ts'

interface V2Entry {
  name?: string
  version?: string
  resolved?: string
  dev?: boolean
  link?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface V1Entry {
  version?: string
  dev?: boolean
  dependencies?: Record<string, V1Entry>
}

const NM = 'node_modules/'

/** A JSON object (not null, not an array). */
function isEntry<T extends object>(v: unknown): v is T {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseNpmLock(text: string, manifests: Manifests = {}): LockfileParse {
  const warnings: string[] = []
  let lock: { lockfileVersion?: number; packages?: Record<string, V2Entry>; dependencies?: Record<string, V1Entry> }
  try {
    lock = JSON.parse(text)
  } catch {
    return { kind: 'npm', ecosystem: 'npm', packages: [], warnings: ['package-lock.json is not valid JSON.'] }
  }
  if (!lock || typeof lock !== 'object') {
    return { kind: 'npm', ecosystem: 'npm', packages: [], warnings: ['package-lock.json is not a lockfile object.'] }
  }
  const out: ResolvedPackage[] = []
  const fromManifest = npmManifestDeps(manifests)
  let skipped = 0

  if (lock.packages && typeof lock.packages === 'object') {
    // Names that a workspace or the root lists directly.
    const direct = new Set<string>([...fromManifest.prod.keys(), ...fromManifest.dev.keys()])
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (!isEntry(entry)) continue
      if (!key.includes(NM)) {
        for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
          for (const n of Object.keys(entry[field] ?? {})) direct.add(n)
        }
      }
    }
    for (const [key, entry] of Object.entries(lock.packages)) {
      const at = key.lastIndexOf(NM)
      if (at < 0 || !isEntry(entry) || entry.link) continue
      const installedAs = key.slice(at + NM.length)
      const name = typeof entry.name === 'string' ? entry.name : installedAs
      const version = typeof entry.version === 'string' ? entry.version : ''
      const nonRegistry = typeof entry.resolved === 'string' && !/^https?:\/\//.test(entry.resolved)
      if (!EXACT_SEMVER.test(version) || nonRegistry) {
        skipped++
        continue
      }
      // Hoisted to the top of a node_modules folder (root or a workspace): listed directly there.
      const topLevel = !key.slice(0, at).includes(NM)
      out.push({ ecosystem: 'npm', name, version, dev: entry.dev === true, direct: topLevel && direct.has(installedAs) })
    }
  } else if (lock.dependencies && typeof lock.dependencies === 'object') {
    const walk = (deps: Record<string, V1Entry>, depth: number) => {
      for (const [installedAs, entry] of Object.entries(deps)) {
        if (!isEntry(entry)) continue
        let name = installedAs
        let version = typeof entry.version === 'string' ? entry.version : ''
        // An alias records "npm:real-name@1.2.3".
        const alias = /^npm:(@?[^@]+)@(.+)$/.exec(version)
        if (alias) {
          name = alias[1]
          version = alias[2]
        }
        if (EXACT_SEMVER.test(version)) {
          out.push({
            ecosystem: 'npm',
            name,
            version,
            dev: entry.dev === true,
            direct: depth === 0 && (fromManifest.prod.has(installedAs) || fromManifest.dev.has(installedAs)),
          })
        } else {
          skipped++
        }
        if (isEntry(entry.dependencies)) walk(entry.dependencies, depth + 1)
      }
    }
    walk(lock.dependencies, 0)
  } else {
    warnings.push('package-lock.json has neither "packages" nor "dependencies".')
  }
  if (skipped > 0) warnings.push(`${skipped} entr${skipped === 1 ? 'y' : 'ies'} without a registry version (git, file or link) skipped.`)
  return { kind: 'npm', ecosystem: 'npm', packages: dedupePackages(out), warnings }
}
