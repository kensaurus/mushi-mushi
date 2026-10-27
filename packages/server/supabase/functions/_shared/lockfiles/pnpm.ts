/**
 * FILE: _shared/lockfiles/pnpm.ts
 * PURPOSE: pnpm-lock.yaml (lockfileVersion 5.x, 6.x and 9.x) → resolved npm
 *          packages with their dev flag.
 *
 * - v9 splits `packages` (metadata) from `snapshots` (the resolved graph,
 *   keys carry peer suffixes like `react-dom@18.2.0(react@18.2.0)`). There
 *   is no dev flag, so production is everything reachable from the
 *   importers' `dependencies` and `optionalDependencies`.
 * - v6 keys look like `/name@1.2.3(peer@1.0.0)` and carry `dev: true|false`.
 * - v5 keys look like `/name/1.2.3_peer@1.0.0` and carry `dev`.
 * Links (`link:`), local files and git or tarball sources are skipped.
 *
 * Two more rules from pnpm's docs (pnpm.io/lockfile and
 * pnpm.io/settings/peer-dependencies, read 2026-10-22):
 * - A lockfile can hold two YAML documents: an env lockfile (pnpm's own
 *   binaries, config dependencies) and then the project lockfile. Only the
 *   last document is the project's graph.
 * - With autoInstallPeers, pnpm lists an auto-installed peer under the
 *   importer's `dependencies`, though "it is not a dependency the project
 *   declares". An entry the importer's package.json lists only under
 *   peerDependencies is therefore neither a production root nor direct.
 */

import { dedupePackages, EXACT_SEMVER, reachable, splitAt, type LockfileParse, type Manifests, type ResolvedPackage } from './types.ts'
import { mapAt, parseYamlLite, strAt, type YamlMap } from './yaml-lite.ts'

/** Strip a peer suffix: `1.2.3(react@18.2.0)` → `1.2.3`, v5 `1.2.3_react@18.2.0` → `1.2.3`. */
function baseVersion(v: string, v5: boolean): string {
  const paren = v.indexOf('(')
  let out = paren >= 0 ? v.slice(0, paren) : v
  if (v5) {
    const us = out.indexOf('_')
    if (us >= 0) out = out.slice(0, us)
  }
  return out
}

/** A packages/snapshots key → name and exact version, or null for a non-registry source. */
function parseKey(rawKey: string, v5: boolean): { name: string; version: string } | null {
  const key = rawKey.startsWith('/') ? rawKey.slice(1) : rawKey
  if (v5) {
    const i = key.lastIndexOf('/')
    if (i <= 0) return null
    const version = baseVersion(key.slice(i + 1), true)
    return EXACT_SEMVER.test(version) ? { name: key.slice(0, i), version } : null
  }
  const noPeers = key.indexOf('(') >= 0 ? key.slice(0, key.indexOf('(')) : key
  const parts = splitAt(noPeers)
  if (!parts) return null
  return EXACT_SEMVER.test(parts[1]) ? { name: parts[0], version: parts[1] } : null
}

/** The graph node an importer or snapshot reference points at, or null for a link. */
function refKey(depName: string, ref: string, v5: boolean): string | null {
  if (!ref || /^(link|file|workspace):/.test(ref)) return null
  if (v5) return ref.startsWith('/') ? ref.slice(1) : `${depName}/${ref}`
  if (ref.startsWith('/')) return ref.slice(1)
  // An alias resolves to "real-name@1.2.3"; a plain ref is the version (with peers).
  const alias = splitAt(ref.indexOf('(') >= 0 ? ref.slice(0, ref.indexOf('(')) : ref)
  if (alias && !/^\d/.test(ref)) return ref
  return `${depName}@${ref}`
}

/** Importer dependency value: v6/v9 `{ specifier, version }`, v5 a bare version. */
function importerRef(v: unknown): string | null {
  if (typeof v === 'string') return v
  return strAt(mapAt(v as YamlMap).version)
}

/** The project lockfile: the last of the YAML documents (`---` lines split them). */
function projectDocument(text: string): string {
  const docs = text.split(/^---[ \t]*$/m).filter((d) => d.trim())
  return docs.length > 0 ? docs[docs.length - 1] : text
}

/** Names an importer's package.json declares only as peers (auto-installed by pnpm, not declared). */
function peerOnlyNames(manifest: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!manifest) return out
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(manifest) as Record<string, unknown>
  } catch {
    return out
  }
  const keys = (field: string) => Object.keys((pkg[field] && typeof pkg[field] === 'object' ? pkg[field] : {}) as Record<string, unknown>)
  const declared = new Set([...keys('dependencies'), ...keys('optionalDependencies'), ...keys('devDependencies')])
  for (const name of keys('peerDependencies')) if (!declared.has(name)) out.add(name)
  return out
}

function joinPath(dir: string, rel: string): string {
  const parts: string[] = []
  for (const seg of `${dir}/${rel}`.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * `manifests` maps repo path → package.json text for the lockfile's
 * importers; `lockDir` is the lockfile's folder ('' at the repo root).
 */
export function parsePnpmLock(text: string, manifests: Manifests = {}, lockDir = ''): LockfileParse {
  const warnings: string[] = []
  let doc: YamlMap
  try {
    doc = parseYamlLite(projectDocument(text))
  } catch {
    return { kind: 'pnpm', ecosystem: 'npm', packages: [], warnings: ['pnpm-lock.yaml could not be read.'] }
  }
  const versionText = strAt(doc.lockfileVersion) ?? ''
  const major = Number.parseFloat(versionText.replace(/^'|'$/g, ''))
  if (!Number.isFinite(major)) {
    return { kind: 'pnpm', ecosystem: 'npm', packages: [], warnings: ['pnpm-lock.yaml has no lockfileVersion.'] }
  }
  const v5 = major < 6
  const packages = mapAt(doc.packages)
  // v9 keeps the graph in snapshots; older formats in packages.
  const graph = major >= 9 ? mapAt(doc.snapshots) : packages

  // Importers: v6+ workspaces, or the single-project top level (v5/v6).
  const importers: Array<[string, YamlMap]> = Object.keys(mapAt(doc.importers)).length > 0
    ? Object.entries(mapAt(doc.importers)).map(([k, v]) => [k, mapAt(v)])
    : [['.', doc]]
  const prodRoots: string[] = []
  // `name@version` of what an importer lists itself (an alias resolves to the real package).
  const directBase = new Set<string>()
  let peersSkipped = 0
  for (const [importer, imp] of importers) {
    const peersOnly = peerOnlyNames(manifests[joinPath(lockDir, `${importer}/package.json`)])
    for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
      for (const [name, v] of Object.entries(mapAt(imp[field]))) {
        if (field !== 'devDependencies' && peersOnly.has(name)) {
          peersSkipped++
          continue
        }
        const ref = importerRef(v)
        const node = ref ? refKey(name, ref, v5) : null
        if (!node) continue
        const p = parseKey(node, v5)
        if (p) directBase.add(`${p.name}@${p.version}`)
        if (field !== 'devDependencies') prodRoots.push(node)
      }
    }
  }

  const edges = (node: string): string[] => {
    const entry = mapAt(graph[node] ?? graph[`/${node}`])
    const out: string[] = []
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [name, v] of Object.entries(mapAt(entry[field]))) {
        const ref = typeof v === 'string' ? refKey(name, v, v5) : null
        if (ref) out.push(ref)
      }
    }
    return out
  }
  const prod = reachable(prodRoots, edges)
  const prodBase = new Set<string>()
  for (const n of prod) {
    const p = parseKey(n, v5)
    if (p) prodBase.add(`${p.name}@${p.version}`)
  }

  const out: ResolvedPackage[] = []
  let skipped = 0
  const keys = new Set([...Object.keys(packages), ...Object.keys(graph)])
  for (const key of keys) {
    const p = parseKey(key, v5)
    if (!p) {
      skipped++
      continue
    }
    const meta = mapAt(packages[key])
    const devFlag = strAt(meta.dev)
    // v5/v6 record dev; v9 does not, so it comes from the graph walk.
    const dev = devFlag === 'true' ? true : devFlag === 'false' ? false : !prodBase.has(`${p.name}@${p.version}`)
    out.push({ ecosystem: 'npm', name: p.name, version: p.version, dev, direct: directBase.has(`${p.name}@${p.version}`) })
  }
  if (peersSkipped > 0) warnings.push(`${peersSkipped} auto-installed peer entr${peersSkipped === 1 ? 'y' : 'ies'} (declared only in peerDependencies) not counted as production.`)
  if (skipped > 0) warnings.push(`${skipped} entr${skipped === 1 ? 'y' : 'ies'} without a registry version (git, file, tarball or link) skipped.`)
  return { kind: 'pnpm', ecosystem: 'npm', packages: dedupePackages(out), warnings }
}
