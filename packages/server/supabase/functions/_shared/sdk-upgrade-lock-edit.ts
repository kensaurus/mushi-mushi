/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-lock-edit.ts
 * PURPOSE: Read the lockfiles for an SDK upgrade and, when the host has no
 *          lockfile workflow, rewrite npm v2/v3 @mushi-mushi entries.
 *          pnpm and yarn are named, not edited (ADR 0043, proposed).
 */

const SCOPE = '@mushi-mushi/'
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
const LOCK_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'] as const

export type LockKind = 'npm' | 'pnpm' | 'yarn'

export interface GovernedLock {
  kind: LockKind
  path: string
  manifests: string[]
}

export interface LockfileEdit {
  files: Array<{ path: string; contents: string; reason: string }>
  outcome: 'none' | 'npm_updated' | 'manual'
  commands: string[]
  reasons: string[]
}

export function refreshCommand(kind: LockKind): string {
  if (kind === 'pnpm') return 'pnpm install --lockfile-only'
  if (kind === 'yarn') return 'yarn install'
  return 'npm install --package-lock-only'
}

function kindOf(fileName: string): LockKind | null {
  if (fileName === 'pnpm-lock.yaml') return 'pnpm'
  if (fileName === 'package-lock.json' || fileName === 'npm-shrinkwrap.json') return 'npm'
  if (fileName === 'yarn.lock') return 'yarn'
  return null
}

function dirOf(manifestPath: string): string {
  return manifestPath === 'package.json' ? '' : manifestPath.slice(0, -'/package.json'.length)
}

function chooseLock(names: readonly string[], pm: LockKind | undefined): string {
  if (pm === 'npm' && names.includes('npm-shrinkwrap.json')) return 'npm-shrinkwrap.json'
  if (pm) {
    const hit = names.find((name) => kindOf(name) === pm)
    if (hit) return hit
  }
  if (names.includes('pnpm-lock.yaml')) return 'pnpm-lock.yaml'
  if (names.includes('npm-shrinkwrap.json')) return 'npm-shrinkwrap.json'
  if (names.includes('package-lock.json')) return 'package-lock.json'
  return 'yarn.lock'
}

/** Nearest lockfile for each changed manifest. Same order as the host workflow. */
export function governedLocks(
  manifestPaths: string[],
  files: Set<string>,
  packageManagerByDir: Map<string, LockKind>,
): GovernedLock[] {
  const byPath = new Map<string, GovernedLock>()
  for (const manifest of manifestPaths) {
    let dir = dirOf(manifest)
    let found: { kind: LockKind; path: string } | null = null
    for (;;) {
      const names = LOCK_NAMES.filter((name) => files.has(dir ? `${dir}/${name}` : name))
      if (names.length) {
        const pm = packageManagerByDir.get(dir) ?? packageManagerByDir.get('')
        const chosen = chooseLock(names, pm)
        found = { kind: kindOf(chosen)!, path: dir ? `${dir}/${chosen}` : chosen }
        break
      }
      if (!dir) break
      const slash = dir.lastIndexOf('/')
      dir = slash < 0 ? '' : dir.slice(0, slash)
    }
    if (!found) continue
    const row = byPath.get(found.path) ?? { ...found, manifests: [] }
    row.manifests.push(manifest)
    byPath.set(found.path, row)
  }
  return [...byPath.values()]
}

export function packageManagerOf(pkgText: string): LockKind | null {
  try {
    const name = String((JSON.parse(pkgText) as { packageManager?: unknown }).packageManager ?? '').split('@')[0]
    return name === 'npm' || name === 'pnpm' || name === 'yarn' ? name : null
  } catch {
    return null
  }
}

export function bumpedRanges(pkgText: string, bumped: Set<string>): Record<string, Record<string, string>> {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(pkgText) as Record<string, unknown>
  } catch {
    return {}
  }
  const out: Record<string, Record<string, string>> = {}
  for (const field of DEP_FIELDS) {
    const section = pkg[field]
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue
    const ranges: Record<string, string> = {}
    for (const [name, spec] of Object.entries(section as Record<string, unknown>)) {
      if (typeof spec === 'string' && bumped.has(name)) ranges[name] = spec
    }
    if (Object.keys(ranges).length) out[field] = ranges
  }
  return out
}

export function lockKeyFor(manifestPath: string, lockPath: string): string {
  const lockDir = lockPath.includes('/') ? lockPath.slice(0, lockPath.lastIndexOf('/')) : ''
  const manifestDir = dirOf(manifestPath)
  if (manifestDir === lockDir) return ''
  if (!lockDir) return manifestDir
  return manifestDir.startsWith(`${lockDir}/`) ? manifestDir.slice(lockDir.length + 1) : manifestDir
}

export function overridesOf(pkgText: string): Record<string, unknown> | undefined {
  try {
    const value = (JSON.parse(pkgText) as { overrides?: unknown }).overrides
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* manifest is parsed again by bumpedRanges */ }
  return undefined
}

export function mushiNamesInLock(lockText: string): string[] {
  try {
    const lock = JSON.parse(lockText) as { packages?: Record<string, unknown> }
    const names = new Set<string>()
    for (const key of Object.keys(lock.packages ?? {})) {
      const at = key.lastIndexOf('node_modules/')
      if (at < 0) continue
      const name = key.slice(at + 'node_modules/'.length)
      if (name.startsWith(SCOPE)) names.add(name)
    }
    return [...names]
  } catch {
    return []
  }
}

/** Versions already pinned to npm latest, so a reused PR can still refresh its lock. */
export function exactPins(
  manifests: Array<{ path: string; contents: string }>,
  latest: Record<string, string>,
): Array<{ package: string; to: string }> {
  const bumps: Array<{ package: string; to: string }> = []
  for (const manifest of manifests) {
    let pkg: Record<string, unknown>
    try {
      pkg = JSON.parse(manifest.contents) as Record<string, unknown>
    } catch {
      continue
    }
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const section = pkg[field]
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue
      for (const [name, spec] of Object.entries(section as Record<string, unknown>)) {
        if (!name.startsWith(SCOPE) || typeof spec !== 'string') continue
        const to = latest[name]
        if (!to || !EXACT_PIN.test(to)) continue
        const core = spec.replace(/^[\^~>=<\s]+/, '').trim()
        if (core === to) bumps.push({ package: name, to })
      }
    }
  }
  return bumps
}

const EXACT_PIN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/

export function decodeGithubBase64(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const content = (body as { content?: unknown }).content
  if (typeof content !== 'string' || !content) return null
  try {
    const binary = atob(content.replace(/\s/g, ''))
    return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)))
  } catch {
    return null
  }
}
