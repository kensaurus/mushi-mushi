/**
 * FILE: _shared/lockfiles/types.ts
 * PURPOSE: Shared shapes and helpers for the lockfile parsers (ADR 0038).
 *
 * Every parser is pure: text in, package coordinates out. Only the
 * coordinates (ecosystem, name, exact version, dev flag) leave a parser;
 * `resolved` URLs, integrity hashes and registry hosts are never kept,
 * because a private registry URL can carry a token.
 */

/** OSV ecosystem names. */
export type Ecosystem = 'npm' | 'Packagist' | 'PyPI' | 'Go'

export type LockfileKind = 'npm' | 'pnpm' | 'yarn' | 'composer' | 'poetry' | 'uv' | 'requirements' | 'gosum'

export interface ResolvedPackage {
  ecosystem: Ecosystem
  /** Registry name (npm scoped names keep their scope; PyPI names are PEP 503 normalised). */
  name: string
  /** The exact resolved version, as the registry and OSV spell it. */
  version: string
  /** Installed only for development (devDependencies, packages-dev, a dev group). */
  dev: boolean
  /** Named in a manifest, not only pulled in by another package. */
  direct: boolean
}

export interface LockfileParse {
  kind: LockfileKind
  ecosystem: Ecosystem
  packages: ResolvedPackage[]
  /** Plain-English notes: a skipped entry, an unknown format, dev flags guessed. */
  warnings: string[]
}

/** Manifests read beside a lockfile, path → text (package.json, composer.json, pyproject.toml, go.mod). */
export type Manifests = Record<string, string>

/** A plain exact semver: 1.2.3, 1.2.3-rc.1, 1.2.3+build. */
export const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** PEP 503 name normalisation. */
export function normalizePypiName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-')
}

/** `name@range` → [name, range]; the first `@` of a scoped name is part of the name. */
export function splitAt(spec: string): [string, string] | null {
  const i = spec.lastIndexOf('@')
  if (i <= 0) return null
  return [spec.slice(0, i), spec.slice(i + 1)]
}

/**
 * One row per (name, version). A package installed for production anywhere
 * is production; named in a manifest anywhere is direct.
 */
export function dedupePackages(packages: ResolvedPackage[]): ResolvedPackage[] {
  const out = new Map<string, ResolvedPackage>()
  for (const p of packages) {
    const key = `${p.ecosystem}\u0000${p.name}\u0000${p.version}`
    const seen = out.get(key)
    if (!seen) out.set(key, { ...p })
    else {
      seen.dev = seen.dev && p.dev
      seen.direct = seen.direct || p.direct
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** Breadth-first closure of `roots` over `edges`. */
export function reachable(roots: Iterable<string>, edges: (node: string) => Iterable<string>): Set<string> {
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const n = queue.shift()!
    if (seen.has(n)) continue
    seen.add(n)
    for (const next of edges(n)) if (!seen.has(next)) queue.push(next)
  }
  return seen
}

/** Dependency names of package.json manifests: prod (dependencies, optional, peer) and all. */
export function npmManifestDeps(manifests: Manifests): { prod: Map<string, Set<string>>; dev: Map<string, Set<string>>; any: boolean } {
  const prod = new Map<string, Set<string>>()
  const dev = new Map<string, Set<string>>()
  let any = false
  const add = (m: Map<string, Set<string>>, name: string, range: unknown) => {
    if (typeof range !== 'string') return
    if (!m.has(name)) m.set(name, new Set())
    m.get(name)!.add(range)
  }
  for (const [path, text] of Object.entries(manifests)) {
    if (!/(^|\/)package\.json$/.test(path)) continue
    let pkg: Record<string, unknown>
    try {
      pkg = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    any = true
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps = pkg[field]
      if (deps && typeof deps === 'object') for (const [n, r] of Object.entries(deps as Record<string, unknown>)) add(prod, n, r)
    }
    const devDeps = pkg.devDependencies
    if (devDeps && typeof devDeps === 'object') for (const [n, r] of Object.entries(devDeps as Record<string, unknown>)) add(dev, n, r)
  }
  return { prod, dev, any }
}
