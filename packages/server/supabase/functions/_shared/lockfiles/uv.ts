/**
 * FILE: _shared/lockfiles/uv.ts
 * PURPOSE: uv.lock → resolved PyPI packages with their dev flag.
 *
 * Each `[[package]]` has `name`, `version` and `source`. Only
 * `source = { registry = … }` is a registry package; `editable`, `virtual`,
 * `git`, `path`, `directory` and `url` are skipped. The project itself (and
 * every workspace member) is a package with a `virtual` or `editable`
 * source: production is the closure of its `dependencies` and its
 * `[package.optional-dependencies]` extras (an extra named like a dev group,
 * `dev` or `test`, is dev), over each package's `dependencies` plus the
 * extras a dependency asks for (`{ name = "uvicorn", extra = ["standard"] }`).
 * `[package.dev-dependencies]` groups are dev. A dependency that names a
 * `version` (a lock with several versions of one package) points at that
 * version only. Without a root package, pyproject.toml's names are used.
 */

import { dedupePackages, normalizePypiName, reachable, type LockfileParse, type Manifests, type ResolvedPackage } from './types.ts'
import { arrayAt, parseTomlLite, tableAt, type TomlTable, type TomlValue } from './toml-lite.ts'
import { DEV_EXTRA, EXACT_PEP440, pyprojectDeps } from './pyproject.ts'

interface Pkg {
  name: string
  version: string
  registry: boolean
  root: boolean
  deps: TomlValue[]
  extras: TomlTable
  devGroups: TomlTable
}

export function parseUvLock(text: string, manifests: Manifests = {}): LockfileParse {
  const warnings: string[] = []
  let doc: TomlTable
  try {
    doc = parseTomlLite(text)
  } catch {
    return { kind: 'uv', ecosystem: 'PyPI', packages: [], warnings: ['uv.lock could not be read.'] }
  }
  const pkgs: Pkg[] = []
  for (const raw of arrayAt(doc.package)) {
    const p = tableAt(raw)
    if (typeof p.name !== 'string') continue
    const source = tableAt(p.source)
    pkgs.push({
      name: normalizePypiName(p.name),
      version: typeof p.version === 'string' ? p.version : '',
      registry: typeof source.registry === 'string',
      root: 'virtual' in source || 'editable' in source,
      deps: arrayAt(p.dependencies),
      extras: tableAt(p['optional-dependencies']),
      devGroups: tableAt(p['dev-dependencies']),
    })
  }
  if (pkgs.length === 0) warnings.push('uv.lock lists no packages.')

  const byName = new Map<string, number[]>()
  pkgs.forEach((p, i) => byName.set(p.name, [...(byName.get(p.name) ?? []), i]))

  /** A `{ name, version?, extra? }` reference → graph nodes: `i` for the package, `i[extra]` for an extra of it. */
  const refNodes = (ref: TomlValue): string[] => {
    const r = tableAt(ref)
    if (typeof r.name !== 'string') return []
    const version = typeof r.version === 'string' ? r.version : null
    const targets = (byName.get(normalizePypiName(r.name)) ?? []).filter((i) => version === null || pkgs[i].version === version)
    const extras = arrayAt(r.extra).filter((e): e is string => typeof e === 'string')
    return targets.flatMap((i) => [String(i), ...extras.map((e) => `${i}[${e}]`)])
  }
  const listNodes = (list: TomlValue | undefined): string[] => arrayAt(list).flatMap(refNodes)
  const edges = (node: string): string[] => {
    const m = /^(\d+)(?:\[(.+)\])?$/.exec(node)
    if (!m) return []
    const p = pkgs[Number(m[1])]
    return m[2] === undefined ? p.deps.flatMap(refNodes) : [String(m[1]), ...listNodes(p.extras[m[2]])]
  }

  const prodRoots: string[] = []
  const devRoots: string[] = []
  const roots = pkgs.filter((p) => p.root)
  for (const r of roots) {
    prodRoots.push(...r.deps.flatMap(refNodes))
    for (const [extra, list] of Object.entries(r.extras)) (DEV_EXTRA.test(extra) ? devRoots : prodRoots).push(...listNodes(list))
    for (const list of Object.values(r.devGroups)) devRoots.push(...listNodes(list))
  }
  let decided = roots.length > 0
  if (!decided) {
    const manifest = pyprojectDeps(manifests)
    if (manifest.any) {
      decided = true
      for (const n of manifest.prod) prodRoots.push(...(byName.get(n) ?? []).map(String))
      for (const n of manifest.dev) devRoots.push(...(byName.get(n) ?? []).map(String))
    }
  }
  const index = (nodes: Iterable<string>): Set<number> => new Set([...nodes].map((n) => Number(/^\d+/.exec(n)![0])))
  const prod = index(reachable(prodRoots, edges))
  const direct = index([...prodRoots, ...devRoots])

  const out: ResolvedPackage[] = []
  let local = 0
  let inexact = 0
  pkgs.forEach((p, i) => {
    if (p.root) return
    if (!p.registry) {
      local++
      return
    }
    if (!EXACT_PEP440.test(p.version)) {
      inexact++
      return
    }
    out.push({ ecosystem: 'PyPI', name: p.name, version: p.version, dev: decided ? !prod.has(i) : false, direct: direct.has(i) })
  })
  if (local > 0) warnings.push(`${local} package${local === 1 ? '' : 's'} from git, a local path or a URL skipped.`)
  if (inexact > 0) warnings.push(`${inexact} package${inexact === 1 ? '' : 's'} without an exact version skipped.`)
  if (!decided && out.length > 0) {
    warnings.push('uv.lock has no project package and no pyproject.toml was read, so dev dependencies could not be told apart; every package counts as production.')
  }
  return { kind: 'uv', ecosystem: 'PyPI', packages: dedupePackages(out), warnings }
}
