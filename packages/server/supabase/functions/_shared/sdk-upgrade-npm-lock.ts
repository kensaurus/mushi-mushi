/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-npm-lock.ts
 * PURPOSE: When an SDK upgrade PR has no host lockfile workflow (ADR 0019),
 *          update package-lock.json (lockfileVersion 2 or 3) so `npm ci`
 *          accepts the new @mushi-mushi/* versions. Pure edit: version,
 *          resolved, integrity and the ranges that point at those packages,
 *          taken from the npm packument. pnpm and yarn lockfiles are named,
 *          not rewritten (ADR 0043).
 */

const SCOPE = '@mushi-mushi/'
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
const LOCK_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'] as const

type LockKind = 'npm' | 'pnpm' | 'yarn'
type Ver = [number, number, number]

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

interface Meta {
  version: string
  resolved: string
  integrity: string
  dependencies: Record<string, string>
  optionalDependencies: Record<string, string>
  peerDependencies: Record<string, string>
}

export interface GovernedLock {
  kind: LockKind
  path: string
  manifests: string[]
}

/** `^1.2.3`, `~1.2.3`, `>=1.2.3 <2.0.0`, exact, and `||`. Enough for registry ranges. */
export function semverSatisfies(version: string, range: string): boolean {
  const v = parseVer(version)
  if (!v) return false
  const trimmed = range.trim()
  if (trimmed === '*' || trimmed === 'x' || trimmed === '') return true
  return trimmed.split('||').some((part) => {
    const comps = part.trim().match(/(>=|<=|>|<|~|\^|=)?\s*\d+\.\d+\.\d+/g)
    return Boolean(comps?.length) && comps!.every((c) => satisfiesComp(v, c.replace(/\s/g, '')))
  })
}

function parseVer(v: string): Ver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function cmpVer(a: string, b: string): number {
  const pa = parseVer(a)
  const pb = parseVer(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  return 0
}

function cmpTuple(a: Ver, b: Ver): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

function satisfiesComp(v: Ver, c: string): boolean {
  const op = /^(>=|<=|>|<|~|\^|=)/.exec(c)?.[1] ?? ''
  const ver = parseVer(c.slice(op.length))
  if (!ver) return false
  if (op === '^') {
    if (cmpTuple(v, ver) < 0) return false
    if (ver[0] > 0) return v[0] === ver[0]
    if (ver[1] > 0) return v[0] === 0 && v[1] === ver[1]
    return v[0] === 0 && v[1] === 0 && v[2] === ver[2]
  }
  if (op === '~') return cmpTuple(v, ver) >= 0 && v[0] === ver[0] && v[1] === ver[1]
  const d = cmpTuple(v, ver)
  if (op === '>=') return d >= 0
  if (op === '<=') return d <= 0
  if (op === '>') return d > 0
  if (op === '<') return d < 0
  return d === 0
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

/** Nearest lockfile for each changed manifest. Mirrors the host workflow's choice. */
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
      const names = LOCK_NAMES.filter((n) => files.has(dir ? `${dir}/${n}` : n))
      if (names.length) {
        const pm = packageManagerByDir.get(dir) ?? packageManagerByDir.get('')
        const chosen = chooseLock(names, pm)
        const kind = kindOf(chosen)!
        found = { kind, path: dir ? `${dir}/${chosen}` : chosen }
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

function chooseLock(names: readonly string[], pm: LockKind | undefined): string {
  if (pm === 'npm' && names.includes('npm-shrinkwrap.json')) return 'npm-shrinkwrap.json'
  if (pm) {
    const hit = names.find((n) => kindOf(n) === pm)
    if (hit) return pm === 'npm' && names.includes('npm-shrinkwrap.json') ? 'npm-shrinkwrap.json' : hit
  }
  if (names.includes('pnpm-lock.yaml')) return 'pnpm-lock.yaml'
  if (names.includes('npm-shrinkwrap.json')) return 'npm-shrinkwrap.json'
  if (names.includes('package-lock.json')) return 'package-lock.json'
  return 'yarn.lock'
}

function installedName(key: string, entry: unknown): string | null {
  const at = key.lastIndexOf('node_modules/')
  if (at < 0 || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  if ((entry as { link?: unknown }).link === true) return null
  const name = key.slice(at + 'node_modules/'.length)
  const alias = (entry as { name?: unknown }).name
  if (typeof alias === 'string' && alias !== name) return null
  return name || null
}

function stringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
  }
  return out
}

function mushiOnly(deps: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(deps)) if (k.startsWith(SCOPE)) out[k] = v
  return out
}

function metaOf(pack: NpmPackument | undefined, version: string): Meta | null {
  const row = pack?.versions?.[version]
  const tarball = row?.dist?.tarball
  const integrity = row?.dist?.integrity
  if (!row || !tarball?.startsWith('https://') || !integrity?.startsWith('sha')) return null
  if (row.version && row.version !== version) return null
  return {
    version,
    resolved: tarball,
    integrity,
    dependencies: stringMap(row.dependencies),
    optionalDependencies: stringMap(row.optionalDependencies),
    peerDependencies: stringMap(row.peerDependencies),
  }
}

function pickTransitive(ranges: string[], pack: NpmPackument | undefined, locked: string[]): string | null {
  if (!pack) return null
  const ok = (v: string) => EXACT.test(v) && Boolean(pack.versions[v]) && ranges.every((r) => semverSatisfies(v, r))
  const kept = locked.filter(ok).sort((a, b) => cmpVer(b, a))
  if (kept[0]) return kept[0]
  if (pack.latest && ok(pack.latest)) return pack.latest
  let best: string | null = null
  for (const v of Object.keys(pack.versions)) {
    if (!ok(v)) continue
    if (!best || cmpVer(v, best) > 0) best = v
  }
  return best
}

function resolveTargets(
  direct: Record<string, string>,
  packs: Record<string, NpmPackument>,
  locked: Map<string, string[]>,
): Map<string, Meta> | { error: string } {
  const chosen = new Map<string, string>()
  for (const [name, version] of Object.entries(direct)) {
    if (EXACT.test(version)) chosen.set(name, version)
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
      if (direct[dep] && EXACT.test(direct[dep])) continue
      const picked = pickTransitive(list, packs[dep], locked.get(dep) ?? [])
      if (!picked) return { error: `no version of ${dep} satisfies ${list.join(' ')}` }
      if (chosen.get(dep) !== picked) {
        chosen.set(dep, picked)
        changed = true
      }
    }
    if (!changed) break
  }
  const targets = new Map<string, Meta>()
  for (const [name, version] of chosen) {
    const meta = metaOf(packs[name], version)
    if (!meta) return { error: `no registry metadata for ${name}@${version}` }
    targets.set(name, meta)
  }
  return targets
}

function treeHas(packages: Record<string, unknown>, name: string): boolean {
  return Object.entries(packages).some(([key, entry]) => installedName(key, entry) === name)
}

function syncMushiField(section: unknown, mushi: Record<string, string>): 'keep' | 'omit' | Record<string, string> {
  if (section !== undefined && (typeof section !== 'object' || section === null || Array.isArray(section))) return 'keep'
  const base = stringMap(section)
  let changed = false
  for (const key of Object.keys(base)) {
    if (!key.startsWith(SCOPE)) continue
    if (!(key in mushi)) {
      delete base[key]
      changed = true
    } else if (base[key] !== mushi[key]) {
      base[key] = mushi[key]
      changed = true
    }
  }
  for (const [key, range] of Object.entries(mushi)) {
    if (base[key] !== range) {
      base[key] = range
      changed = true
    }
  }
  if (!changed) return 'keep'
  return Object.keys(base).length ? base : 'omit'
}

/** A production dependency whose locked copy does not satisfy the new manifest. */
function blockingDep(packages: Record<string, unknown>, meta: Meta): string | null {
  for (const [dep, range] of Object.entries(meta.dependencies)) {
    if (dep.startsWith(SCOPE)) continue
    const versions: string[] = []
    for (const [key, entry] of Object.entries(packages)) {
      if (installedName(key, entry) !== dep || !entry || typeof entry !== 'object') continue
      const ver = (entry as { version?: unknown }).version
      if (typeof ver === 'string') versions.push(ver)
    }
    if (!versions.some((v) => semverSatisfies(v, range))) return dep
  }
  return null
}

function applyEntry(entry: Record<string, unknown>, meta: Meta): void {
  entry.version = meta.version
  entry.resolved = meta.resolved
  entry.integrity = meta.integrity
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const next = syncMushiField(entry[field], mushiOnly(meta[field]))
    if (next === 'omit') delete entry[field]
    else if (next !== 'keep') entry[field] = next
  }
}

function writeJson(original: string, value: unknown): string {
  const nl = original.includes('\r\n') ? '\r\n' : '\n'
  const indent = original.match(/\n(\s+)"/)?.[1] ?? '  '
  let text = JSON.stringify(value, null, indent)
  if (nl !== '\n') text = text.replace(/\n/g, nl)
  if (original.endsWith('\n')) text += nl
  return text
}

export function patchNpmLockfile(
  lockText: string,
  opts: {
    manifests: Array<{ lockKey: string; ranges: Record<string, Record<string, string>> }>
    direct: Record<string, string>
    packuments: Record<string, NpmPackument>
  },
): { ok: true; text: string } | { ok: false; reason: string } {
  let lock: Record<string, unknown>
  try {
    lock = JSON.parse(lockText) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'package-lock.json is not valid JSON' }
  }
  const version = lock.lockfileVersion
  if (version !== 2 && version !== 3) {
    return { ok: false, reason: `lockfileVersion ${String(version)} is not 2 or 3` }
  }
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
    if (!treeHas(pkgs, name)) return { ok: false, reason: `no lock entry for ${name}` }
  }
  for (const spec of opts.manifests) {
    const raw = pkgs[spec.lockKey]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    for (const [field, ranges] of Object.entries(spec.ranges)) {
      const section = entry[field]
      if (section && (typeof section !== 'object' || Array.isArray(section))) continue
      if (!section) {
        entry[field] = { ...ranges }
        continue
      }
      const obj = section as Record<string, unknown>
      for (const [name, range] of Object.entries(ranges)) obj[name] = range
    }
  }
  for (const [key, raw] of Object.entries(pkgs)) {
    const name = installedName(key, raw)
    const meta = name ? targets.get(name) : undefined
    if (!meta || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const missing = blockingDep(pkgs, meta)
    if (missing) return { ok: false, reason: `lock has no entry for ${missing} that satisfies the new manifest` }
    applyEntry(entry, meta)
  }
  const legacy = lock.dependencies
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) patchLegacy(legacy as Record<string, unknown>, targets)
  return { ok: true, text: writeJson(lockText, lock) }
}

function patchLegacy(node: Record<string, unknown>, targets: Map<string, Meta>): void {
  for (const [name, raw] of Object.entries(node)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    const meta = targets.get(name)
    if (meta && typeof entry.version === 'string' && !entry.version.includes(':')) {
      entry.version = meta.version
      entry.resolved = meta.resolved
      entry.integrity = meta.integrity
      const req = entry.requires
      if (req && typeof req === 'object' && !Array.isArray(req)) {
        const obj = req as Record<string, unknown>
        for (const dep of Object.keys(mushiOnly(meta.dependencies))) {
          if (typeof obj[dep] === 'string') obj[dep] = meta.dependencies[dep]
        }
      }
    }
    const nested = entry.dependencies
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) patchLegacy(nested as Record<string, unknown>, targets)
  }
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
    const ranges: Record<string, string> = {}
    for (const [name, spec] of Object.entries(stringMap(pkg[field]))) {
      if (bumped.has(name)) ranges[name] = spec
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

export function mushiNamesInLock(lockText: string): string[] {
  try {
    const lock = JSON.parse(lockText) as { packages?: Record<string, unknown> }
    const names = new Set<string>()
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      const name = installedName(key, entry)
      if (name?.startsWith(SCOPE)) names.add(name)
    }
    return [...names]
  } catch {
    return []
  }
}

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

async function fetchPackument(name: string, fetchImpl: typeof fetch): Promise<NpmPackument | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
      signal: ac.signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as { 'dist-tags'?: { latest?: unknown }; versions?: NpmPackument['versions'] }
    const latest = typeof body['dist-tags']?.latest === 'string' ? body['dist-tags'].latest : null
    const versions = body.versions && typeof body.versions === 'object' ? body.versions : {}
    return { latest, versions }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface LockfileEdit {
  files: Array<{ path: string; contents: string; reason: string }>
  /** `none`: no lockfile. `npm_updated`: package-lock entries rewritten. `manual`: a command is required. */
  outcome: 'none' | 'npm_updated' | 'manual'
  commands: string[]
  reasons: string[]
}

const ROOT_LOCKS = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']

/**
 * Read the lockfiles that govern the bumped manifests and, for npm v2/v3,
 * rewrite the @mushi-mushi entries. Callers skip this when the host workflow
 * is present — that path waits for the package manager instead.
 */
export async function collectLockfileChanges(opts: {
  blobs: Array<{ path: string; sha?: string }>
  treeComplete: boolean
  manifests: Array<{ path: string; contents: string }>
  bumps: Array<{ package: string; to: string }>
  readBlob: (sha: string) => Promise<string | null>
  readContents: (path: string) => Promise<string | null>
  fetchImpl?: typeof fetch
}): Promise<LockfileEdit> {
  const none: LockfileEdit = { files: [], outcome: 'none', commands: [], reasons: [] }
  if (opts.bumps.length === 0 || opts.manifests.length === 0) return none
  const files = new Set(opts.blobs.map((b) => b.path))
  const shaByPath = new Map(opts.blobs.filter((b) => b.sha).map((b) => [b.path, b.sha!]))
  if (!opts.treeComplete) {
    for (const name of ROOT_LOCKS) {
      if (files.has(name)) continue
      const text = await opts.readContents(name)
      if (text) files.add(name)
    }
  }
  const pm = new Map<string, LockKind>()
  for (const manifest of opts.manifests) {
    const kind = packageManagerOf(manifest.contents)
    if (kind) pm.set(dirOf(manifest.path), kind)
  }
  const governed = governedLocks(opts.manifests.map((m) => m.path), files, pm)
  if (governed.length === 0) return none

  const commands: string[] = []
  const reasons: string[] = []
  const seen = new Set<string>()
  const addCommand = (kind: LockKind) => {
    const command = refreshCommand(kind)
    if (!seen.has(command)) {
      seen.add(command)
      commands.push(command)
    }
  }
  for (const lock of governed) {
    if (lock.kind !== 'npm') addCommand(lock.kind)
  }

  const direct: Record<string, string> = {}
  for (const bump of opts.bumps) {
    if (!direct[bump.package] || cmpVer(bump.to, direct[bump.package]) > 0) direct[bump.package] = bump.to
  }
  const bumped = new Set(Object.keys(direct))
  const filesOut: LockfileEdit['files'] = []
  let sawNpm = false
  const fetchImpl = opts.fetchImpl ?? fetch

  for (const lock of governed) {
    if (lock.kind !== 'npm') continue
    sawNpm = true
    const text = await loadText(lock.path, shaByPath.get(lock.path), opts)
    if (!text) {
      addCommand('npm')
      reasons.push(`could not read ${lock.path}`)
      continue
    }
    const names = new Set([...bumped, ...mushiNamesInLock(text)])
    const packuments: Record<string, NpmPackument> = {}
    await Promise.all([...names].map(async (name) => {
      const pack = await fetchPackument(name, fetchImpl)
      if (pack) packuments[name] = pack
    }))
    const patched = patchNpmLockfile(text, {
      direct,
      packuments,
      manifests: lock.manifests.map((path) => ({
        lockKey: lockKeyFor(path, lock.path),
        ranges: bumpedRanges(opts.manifests.find((m) => m.path === path)?.contents ?? '', bumped),
      })),
    })
    if (!patched.ok) {
      addCommand('npm')
      reasons.push(`${lock.path}: ${patched.reason}`)
      continue
    }
    if (patched.text !== text) {
      filesOut.push({ path: lock.path, contents: patched.text, reason: 'update @mushi-mushi/* lock entries' })
    }
  }

  if (commands.length) return { files: filesOut, outcome: 'manual', commands, reasons }
  if (sawNpm) return { files: filesOut, outcome: 'npm_updated', commands: [], reasons }
  return none
}

async function loadText(
  path: string,
  sha: string | undefined,
  opts: { readBlob: (sha: string) => Promise<string | null>; readContents: (path: string) => Promise<string | null> },
): Promise<string | null> {
  if (sha) {
    const fromBlob = await opts.readBlob(sha)
    if (fromBlob) return fromBlob
  }
  return opts.readContents(path)
}
