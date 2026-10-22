/**
 * FILE: _shared/lockfiles/yarn.ts
 * PURPOSE: yarn.lock → resolved npm packages with their dev flag, for both
 *          formats:
 *
 * - yarn classic (v1, `# yarn lockfile v1`): entries keyed by one or more
 *   descriptors (`"lodash@^4.17.0", lodash@^4.17.15:`) with indented
 *   `version "4.17.21"` and `dependencies:` / `optionalDependencies:`
 *   blocks of `name "range"` lines. An alias is `name@npm:real@range`.
 * - yarn berry (v2+, YAML with `__metadata:`): keys like
 *   `"lodash@npm:^4.17.0, lodash@npm:^4.17.15"`, `version: 4.17.21`,
 *   `resolution: "lodash@npm:4.17.21"` (the resolution names the real
 *   package, so aliases resolve through it) and `dependencies:` whose values
 *   are ranges (`npm:^4.17.15`, or `^4.17.15` in older berry).
 *   `patch:` resolutions of an npm package map to that package's version;
 *   `workspace:`, `link:`, `portal:`, `file:`, `exec:`, git and tarball
 *   resolutions are skipped.
 *
 * yarn.lock has no dev flag. Production is the closure of the package.json
 * manifests' production dependencies over the lock's dependency edges (the
 * pnpm v9 approach). Berry's workspace entries list a workspace's dev
 * dependencies beside its production ones, so a workspace reached from
 * production is followed in full (more production, never less). With no
 * manifest every package is production and a warning says dev flags could
 * not be decided.
 */

import { dedupePackages, EXACT_SEMVER, npmManifestDeps, reachable, type LockfileParse, type Manifests, type ResolvedPackage } from './types.ts'
import { mapAt, parseYamlLite, strAt, type YamlMap } from './yaml-lite.ts'

interface Entry {
  /** Descriptors (`name@range`) that resolve to this entry. */
  descriptors: string[]
  /** The real package name and exact version, or null when it is not a registry package. */
  name: string | null
  version: string | null
  /** Dependency descriptors (`name@range`) of this entry. */
  deps: string[]
  workspace: boolean
}

/** `name@range` → [name, range]; the `@` that starts a scoped name is part of the name. */
function splitDescriptor(d: string): [string, string] | null {
  const i = d.indexOf('@', 1)
  if (i <= 0) return null
  return [d.slice(0, i), d.slice(i + 1)]
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(["\\])/g, '$1')
  return t
}

/** Split a key line's descriptor list on commas outside quotes. */
function splitDescriptors(key: string): string[] {
  const out: string[] = []
  let quote = false
  let cur = ''
  for (const c of key) {
    if (c === '"') quote = !quote
    if (c === ',' && !quote) {
      out.push(unquote(cur))
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(unquote(cur))
  return out.filter(Boolean)
}

/** A range a registry resolves (semver range, tag or `npm:` alias), not a git, URL, path or protocol. */
function isRegistryRange(range: string): boolean {
  if (range.startsWith('npm:')) {
    const inner = range.slice(4)
    const parts = splitDescriptor(inner)
    // `npm:^1.2.3`, `npm:real-name@^1.2.3` or a bare `npm:@scope/real-name`.
    return parts ? isRegistryRange(parts[1]) : inner.startsWith('@') || !/[:/]/.test(inner)
  }
  return !/[:/]/.test(range) && !range.startsWith('.')
}

/** `key "value"` / `"key" value` / `key:` (classic) → [key, value]. */
function splitClassicLine(line: string): [string, string] {
  if (line.startsWith('"')) {
    let i = 1
    while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1
    return [unquote(line.slice(0, i + 1)), unquote(line.slice(i + 1).replace(/^:/, ''))]
  }
  const sp = line.search(/[\s:]/)
  if (sp < 0) return [line, '']
  return [line.slice(0, sp), unquote(line.slice(sp + 1).replace(/^:/, ''))]
}

function parseClassic(text: string, warnings: string[]): Entry[] {
  const entries: Entry[] = []
  let entry: Entry | null = null
  let block: string | null = null
  let resolved: string | null = null
  const finish = () => {
    if (!entry) return
    // A git or local resolution keeps a `version`, but it is not the registry package.
    if (resolved && !/^https?:\/\//.test(resolved)) entry.name = null
    entries.push(entry)
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (indent === 0) {
      finish()
      resolved = null
      block = null
      if (!line.endsWith(':')) {
        entry = null
        continue
      }
      const descriptors = splitDescriptors(line.slice(0, -1))
      let name: string | null = null
      let registry = descriptors.length > 0
      for (const d of descriptors) {
        const parts = splitDescriptor(d)
        if (!parts || !isRegistryRange(parts[1])) {
          registry = false
          continue
        }
        const [installedAs, range] = parts
        const alias = range.startsWith('npm:') ? splitDescriptor(range.slice(4)) : null
        // Prefer a descriptor that is not an alias; an alias names its real package after `npm:`.
        if (!alias) name = installedAs
        else if (name === null) name = alias[0]
      }
      entry = { descriptors, name: registry ? name : null, version: null, deps: [], workspace: false }
      continue
    }
    if (!entry) continue
    if (indent <= 2) {
      const [key, value] = splitClassicLine(line)
      block = null
      if (key === 'version') entry.version = value
      else if (key === 'resolved') resolved = value
      else if (value === '' && (key === 'dependencies' || key === 'optionalDependencies')) block = key
      continue
    }
    if (block) {
      const [dep, range] = splitClassicLine(line)
      if (dep && range) entry.deps.push(`${dep}@${range}`)
    }
  }
  finish()
  if (entries.length === 0) warnings.push('yarn.lock has no entries.')
  return entries
}

function parseBerry(text: string, warnings: string[]): Entry[] {
  let doc: YamlMap
  try {
    doc = parseYamlLite(text)
  } catch {
    warnings.push('yarn.lock could not be read.')
    return []
  }
  const entries: Entry[] = []
  let unclearPatches = 0
  for (const [key, value] of Object.entries(doc)) {
    if (key === '__metadata') continue
    const meta = mapAt(value)
    const descriptors = splitDescriptors(key)
    const resolution = strAt(meta.resolution) ?? ''
    const parts = splitDescriptor(resolution)
    let name: string | null = null
    let version: string | null = null
    let workspace = false
    if (parts) {
      let [resName, ref] = parts
      if (ref.startsWith('workspace:')) workspace = true
      if (ref.startsWith('patch:')) {
        // `patch:resolve@npm%3A1.22.8#optional!builtin<compat/resolve>::version=1.22.8&hash=…`
        let inner = ref.slice('patch:'.length)
        const hash = inner.indexOf('#')
        if (hash >= 0) inner = inner.slice(0, hash)
        try {
          inner = decodeURIComponent(inner)
        } catch {
          inner = ''
        }
        const innerParts = splitDescriptor(inner)
        if (innerParts && innerParts[1].startsWith('npm:') && EXACT_SEMVER.test(innerParts[1].slice(4))) {
          resName = innerParts[0]
          ref = innerParts[1]
        } else {
          unclearPatches++
          ref = ''
        }
      }
      if (ref.startsWith('npm:') && EXACT_SEMVER.test(ref.slice(4))) {
        name = resName
        version = ref.slice(4)
      }
    }
    const deps: string[] = []
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dep, range] of Object.entries(mapAt(meta[field]))) {
        const r = strAt(range)
        if (r) deps.push(`${dep}@${r}`)
      }
    }
    entries.push({ descriptors, name, version, deps, workspace })
  }
  if (unclearPatches > 0) {
    warnings.push(`${unclearPatches} patched entr${unclearPatches === 1 ? 'y' : 'ies'} whose underlying npm version is not clear skipped.`)
  }
  if (entries.length === 0) warnings.push('yarn.lock has no entries.')
  return entries
}

export function parseYarnLock(text: string, manifests: Manifests = {}): LockfileParse {
  const warnings: string[] = []
  const berry = /^__metadata:/m.test(text)
  if (!berry && !/^# yarn lockfile v1/m.test(text) && !/^"?[^\s#"][^\n]*@[^\n]*:\s*$/m.test(text)) {
    return { kind: 'yarn', ecosystem: 'npm', packages: [], warnings: ['yarn.lock is not a yarn classic or yarn berry lockfile.'] }
  }
  const entries = berry ? parseBerry(text, warnings) : parseClassic(text, warnings)

  // Descriptor → entry index; berry spells registry ranges `npm:^1.2.3`, older berry and manifests `^1.2.3`.
  const byDescriptor = new Map<string, number>()
  const byName = new Map<string, number[]>()
  entries.forEach((e, i) => {
    for (const d of e.descriptors) {
      byDescriptor.set(d, i)
      const parts = splitDescriptor(d)
      if (parts) byName.set(parts[0], [...(byName.get(parts[0]) ?? []), i])
    }
  })
  const lookup = (descriptor: string): number | undefined => {
    const hit = byDescriptor.get(descriptor)
    if (hit !== undefined) return hit
    const parts = splitDescriptor(descriptor)
    return parts ? byDescriptor.get(`${parts[0]}@npm:${parts[1]}`) : undefined
  }
  /** A manifest dependency → its entries; a stale manifest range falls back to every entry of that name. */
  const resolveManifestDep = (name: string, ranges: Set<string>): number[] => {
    const hits = [...ranges].map((r) => lookup(`${name}@${r}`)).filter((i): i is number => i !== undefined)
    return hits.length > 0 ? hits : byName.get(name) ?? []
  }

  const fromManifest = npmManifestDeps(manifests)
  const direct = new Set<number>()
  const prodRoots: number[] = []
  for (const [name, ranges] of fromManifest.prod) {
    for (const i of resolveManifestDep(name, ranges)) {
      direct.add(i)
      prodRoots.push(i)
    }
  }
  for (const [name, ranges] of fromManifest.dev) for (const i of resolveManifestDep(name, ranges)) direct.add(i)
  // Berry's workspace entries are copies of the workspaces' manifests.
  for (const e of entries) {
    if (!e.workspace) continue
    for (const d of e.deps) {
      const i = lookup(d)
      if (i !== undefined) direct.add(i)
    }
  }

  const edges = (node: string): number[] =>
    entries[Number(node)].deps.map(lookup).filter((i): i is number => i !== undefined)
  const prod = reachable(prodRoots.map(String), (n) => edges(n).map(String))
  if (!fromManifest.any) warnings.push('No package.json was read beside yarn.lock, so dev dependencies could not be told apart; every package counts as production.')

  const out: ResolvedPackage[] = []
  let skipped = 0
  entries.forEach((e, i) => {
    if (e.workspace) return
    if (!e.name || !e.version || !EXACT_SEMVER.test(e.version)) {
      skipped++
      return
    }
    out.push({
      ecosystem: 'npm',
      name: e.name,
      version: e.version,
      dev: fromManifest.any ? !prod.has(String(i)) : false,
      direct: direct.has(i),
    })
  })
  if (skipped > 0) warnings.push(`${skipped} entr${skipped === 1 ? 'y' : 'ies'} without a registry version (git, file, link, portal or tarball) skipped.`)
  return { kind: 'yarn', ecosystem: 'npm', packages: dedupePackages(out), warnings }
}
