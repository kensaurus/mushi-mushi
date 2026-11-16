/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-npm-lock.ts
 * PURPOSE: Update npm lockfile entries when an SDK upgrade PR has no host
 *          lockfile workflow, so `npm ci` sees the bumped @mushi-mushi/* versions.
 *
 * OVERVIEW:
 * - ADR 0019 still prefers the host workflow, which runs the package manager.
 *   This module runs only when that workflow is absent.
 * - It rewrites lockfileVersion 2 and 3 entries from the npm registry document:
 *   version, resolved, integrity, dependency ranges, and install metadata
 *   (bin, engines, hasInstallScript). It does not keep the previous release's
 *   metadata.
 * - A production, optional, or required peer range is accepted only when the
 *   lock already resolves it. @mushi-mushi/* packages already in the lock may
 *   move to the known target version. A missing third-party package, a
 *   required peer with no entry, a bundled dependency, or a v2 legacy node
 *   whose nested copy does not satisfy the new range leaves the lock untouched.
 *
 * DEPENDENCIES: npm registry (registry.npmjs.org) and the GitHub Contents API.
 *
 * USAGE: sdk-upgrade-runner calls planNpmLockfileUpdates. The pure check is
 *        applyNpmLockUpdates.
 */

import type { FileChange } from './github-pr.ts'

/** Same supply-chain cap as computeBumpPlan: never move a locked package more than one major. */
const MAX_MAJOR_JUMP = 1
const MAX_LOCK_BYTES = 8_000_000
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SAFE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i

type Json = Record<string, unknown>

export interface NpmPackument {
  name: string
  version: string
  dependencies: Record<string, string>
  optionalDependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
  bin?: Record<string, string>
  engines?: Record<string, string>
  os?: string[]
  cpu?: string[]
  funding?: unknown
  deprecated?: string
  hasInstallScript: boolean
  license?: string
  integrity: string
  tarball: string
}

export interface ManifestEdit {
  /** Repo path of the package.json that was bumped. */
  path: string
  sections: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  /** Package name → exact version written into the lock entry. */
  versions: Record<string, string>
}

export interface BumpRef {
  path?: string
  package: string
  to: string
}

type ApplyResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; need?: Array<{ name: string; version: string }> }

interface Plan {
  name: string
  version: string
  oldVersion: string
}

interface Semver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

interface PartialVer {
  major: number | null
  minor: number | null
  patch: number | null
  prerelease: string[]
}

type CompOp = '>' | '>=' | '<' | '<=' | '='
interface Comp {
  op: CompOp
  ver: Semver
}

function asRecord(v: unknown): Json | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Json
}

function stringMap(v: unknown): Record<string, string> | null {
  if (v == null) return {}
  const rec = asRecord(v)
  if (!rec) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value !== 'string') return null
    out[key] = value
  }
  return out
}

function stringArray(v: unknown): string[] | null {
  if (v == null) return []
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) return null
  return v as string[]
}

/** True when `version` satisfies an npm range. Unparseable ranges do not match. */
export function satisfiesRange(version: string, range: string): boolean {
  const ver = parseSemver(version)
  if (!ver) return false
  const trimmed = range.trim()
  if (!trimmed) return false
  const sets = trimmed.split('||').map((part) => part.trim()).filter(Boolean)
  if (sets.length === 0) return false
  const parsed: Comp[][] = []
  for (const set of sets) {
    const comps = parseComparatorSet(set)
    if (!comps) return false
    parsed.push(comps)
  }
  return parsed.some((comps) => versionSatisfiesSet(ver, comps))
}

function parseSemver(input: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function cmpIdent(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Number(a) - Number(b)
  if (aNum) return -1
  if (bNum) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function cmpSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const count = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < count; i++) {
    if (i >= a.prerelease.length) return -1
    if (i >= b.prerelease.length) return 1
    const diff = cmpIdent(a.prerelease[i], b.prerelease[i])
    if (diff !== 0) return diff
  }
  return 0
}

function parsePartial(input: string): PartialVer | null {
  if (/^(?:\*|x|X)$/.test(input)) return { major: null, minor: null, patch: null, prerelease: [] }
  const match = /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(input)
  if (!match) return null
  const num = (token: string | undefined): number | null => {
    if (token == null || token === 'x' || token === 'X' || token === '*') return null
    return Number(token)
  }
  const major = num(match[1])
  const minor = match[2] == null ? null : num(match[2])
  const patch = match[3] == null ? null : num(match[3])
  if (match[4] && (major == null || minor == null || patch == null)) return null
  return { major, minor, patch, prerelease: match[4] ? match[4].split('.') : [] }
}

function lowerBound(part: PartialVer): Semver {
  return {
    major: part.major ?? 0,
    minor: part.minor ?? 0,
    patch: part.patch ?? 0,
    prerelease: part.major != null && part.minor != null && part.patch != null ? part.prerelease : [],
  }
}

function nextPartial(part: PartialVer): Semver {
  if (part.minor == null) return { major: (part.major ?? 0) + 1, minor: 0, patch: 0, prerelease: [] }
  if (part.patch == null) return { major: part.major ?? 0, minor: part.minor + 1, patch: 0, prerelease: [] }
  return { major: part.major ?? 0, minor: part.minor, patch: part.patch + 1, prerelease: [] }
}

function caret(part: PartialVer): Comp[] | null {
  if (part.major == null) return null
  const low = lowerBound(part)
  let upper: Semver
  if (part.major > 0) upper = { major: part.major + 1, minor: 0, patch: 0, prerelease: [] }
  else if (part.minor == null) upper = { major: 1, minor: 0, patch: 0, prerelease: [] }
  else if (part.minor > 0) upper = { major: 0, minor: part.minor + 1, patch: 0, prerelease: [] }
  else if (part.patch == null) upper = { major: 0, minor: 1, patch: 0, prerelease: [] }
  else upper = { major: 0, minor: 0, patch: part.patch + 1, prerelease: [] }
  return [{ op: '>=', ver: low }, { op: '<', ver: upper }]
}

function tilde(part: PartialVer): Comp[] | null {
  if (part.major == null) return null
  const upper = part.minor == null
    ? { major: part.major + 1, minor: 0, patch: 0, prerelease: [] }
    : { major: part.major, minor: part.minor + 1, patch: 0, prerelease: [] }
  return [{ op: '>=', ver: lowerBound(part) }, { op: '<', ver: upper }]
}

function bare(part: PartialVer, exact: boolean): Comp[] | null {
  if (part.major == null) return [{ op: '>=', ver: { major: 0, minor: 0, patch: 0, prerelease: [] } }]
  if (part.minor != null && part.patch != null) {
    return [{ op: '=', ver: lowerBound(part) }]
  }
  if (exact && part.patch == null) return tilde(part)
  if (part.minor == null) {
    return [
      { op: '>=', ver: lowerBound(part) },
      { op: '<', ver: { major: part.major + 1, minor: 0, patch: 0, prerelease: [] } },
    ]
  }
  return [
    { op: '>=', ver: lowerBound(part) },
    { op: '<', ver: { major: part.major, minor: part.minor + 1, patch: 0, prerelease: [] } },
  ]
}

function inequality(op: Exclude<CompOp, '='>, part: PartialVer): Comp[] | null {
  if (part.major == null) return null
  const full = part.minor != null && part.patch != null
  if (full) return [{ op, ver: lowerBound(part) }]
  if (op === '>') return [{ op: '>=', ver: nextPartial(part) }]
  if (op === '>=') return [{ op: '>=', ver: lowerBound(part) }]
  if (op === '<') return [{ op: '<', ver: lowerBound(part) }]
  return [{ op: '<', ver: nextPartial(part) }]
}

function parseOne(token: string): Comp[] | null {
  const match = /^(>=|<=|>|<|=|\^|~)?v?(\*|x|X|\d+(?:\.[xX*\d]+)*(?:-[0-9A-Za-z.-]+)?)$/.exec(token)
  if (!match) return null
  const op = match[1] ?? ''
  const part = parsePartial(match[2])
  if (!part) return null
  if (op === '^') return caret(part)
  if (op === '~') return tilde(part)
  if (op === '' || op === '=') return bare(part, op === '=')
  if (op === '>' || op === '>=' || op === '<' || op === '<=') return inequality(op, part)
  return null
}

function parseComparatorSet(part: string): Comp[] | null {
  const tokens = part.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const comps: Comp[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (i + 2 < tokens.length && tokens[i + 1] === '-') {
      const lower = parsePartial(tokens[i])
      const upper = parsePartial(tokens[i + 2])
      if (!lower || !upper) return null
      const low = lowerBound(lower)
      const highFull = upper.major != null && upper.minor != null && upper.patch != null
      comps.push({ op: '>=', ver: low })
      comps.push(highFull
        ? { op: '<=', ver: lowerBound(upper) }
        : { op: '<', ver: nextPartial(upper) })
      i += 2
      continue
    }
    const one = parseOne(tokens[i])
    if (!one) return null
    comps.push(...one)
  }
  return comps
}

function testComp(version: Semver, comp: Comp): boolean {
  const diff = cmpSemver(version, comp.ver)
  if (comp.op === '=') return diff === 0
  if (comp.op === '>') return diff > 0
  if (comp.op === '>=') return diff >= 0
  if (comp.op === '<') return diff < 0
  return diff <= 0
}

function versionSatisfiesSet(version: Semver, comps: Comp[]): boolean {
  if (!comps.every((comp) => testComp(version, comp))) return false
  if (version.prerelease.length === 0) return true
  // A prerelease satisfies a range only when a comparator names that same
  // major.minor.patch with a prerelease. ^1.2.3 does not match 1.2.3-beta.
  return comps.some((comp) =>
    comp.ver.prerelease.length > 0 &&
    comp.ver.major === version.major &&
    comp.ver.minor === version.minor &&
    comp.ver.patch === version.patch
  )
}

function majorJumpTooFar(next: string, current: string): boolean {
  const nextMajor = Number(next.split('.')[0])
  const currentMajor = Number(current.split('.')[0])
  if (!Number.isFinite(nextMajor) || !Number.isFinite(currentMajor)) return true
  return nextMajor - currentMajor > MAX_MAJOR_JUMP
}

function directoryOf(file: string): string {
  const index = file.lastIndexOf('/')
  return index === -1 ? '.' : file.slice(0, index)
}

function parentDirectory(dir: string): string {
  if (dir === '.') return '.'
  const index = dir.lastIndexOf('/')
  return index === -1 ? '.' : dir.slice(0, index)
}

function joinPath(dir: string, name: string): string {
  return dir === '.' ? name : `${dir}/${name}`
}

function manifestKey(path: string): string | null {
  if (path === 'package.json') return ''
  if (!path.endsWith('/package.json')) return null
  return path.slice(0, -'/package.json'.length)
}

function packageNameFromKey(key: string): string | null {
  const marker = 'node_modules/'
  const index = key.lastIndexOf(marker)
  if (index === -1) return null
  const rest = key.slice(index + marker.length)
  if (rest.startsWith('@')) {
    const [scope, name] = rest.split('/')
    return scope && name ? `${scope}/${name}` : null
  }
  const name = rest.split('/')[0]
  return name || null
}

/** Root `node_modules` chain. Workspace prefixes return null so the caller can fall back. */
function nodeModulesChain(key: string): string[] | null {
  if (!key) return null
  const parts = key.split('/')
  const names: string[] = []
  let index = 0
  while (index < parts.length) {
    if (parts[index] !== 'node_modules') return null
    index++
    const scopeOrName = parts[index]
    if (!scopeOrName) return null
    if (scopeOrName.startsWith('@')) {
      const name = parts[index + 1]
      if (!name) return null
      names.push(`${scopeOrName}/${name}`)
      index += 2
    } else {
      names.push(scopeOrName)
      index += 1
    }
  }
  return names.length ? names : null
}

function resolveLockPath(fromKey: string, name: string, packages: Json): string | null {
  let dir = fromKey
  for (let hop = 0; hop < 64; hop++) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`
    if (Object.prototype.hasOwnProperty.call(packages, candidate)) return candidate
    if (!dir) return null
    const slash = dir.lastIndexOf('/')
    dir = slash === -1 ? '' : dir.slice(0, slash)
  }
  return null
}

function entryVersion(entry: Json): string {
  return typeof entry.version === 'string' ? entry.version : ''
}

function isLink(entry: Json): boolean {
  return entry.link === true
}

export function toPackument(raw: unknown, expectName?: string, expectVersion?: string): NpmPackument | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const name = typeof rec.name === 'string' ? rec.name : expectName
  const version = typeof rec.version === 'string' ? rec.version : expectVersion
  if (!name || !version || !SAFE_NAME.test(name) || !SAFE_VERSION.test(version)) return null
  if (expectName && name !== expectName) return null
  if (expectVersion && version !== expectVersion) return null
  const dependencies = stringMap(rec.dependencies)
  const optionalDependencies = stringMap(rec.optionalDependencies)
  const peerDependencies = stringMap(rec.peerDependencies)
  const peerDependenciesMeta = peerMeta(rec.peerDependenciesMeta)
  if (!dependencies || !optionalDependencies || !peerDependencies || !peerDependenciesMeta) return null
  const bin = rec.bin == null ? undefined : normalizeBin(rec.bin, name)
  if (rec.bin != null && !bin) return null
  const engines = rec.engines == null ? undefined : stringMap(rec.engines)
  if (rec.engines != null && !engines) return null
  const os = rec.os == null ? undefined : stringArray(rec.os)
  const cpu = rec.cpu == null ? undefined : stringArray(rec.cpu)
  if (rec.os != null && !os) return null
  if (rec.cpu != null && !cpu) return null
  const dist = asRecord(rec.dist)
  const integrity = typeof dist?.integrity === 'string' ? dist.integrity : typeof rec.integrity === 'string' ? rec.integrity : ''
  const tarball = typeof dist?.tarball === 'string' ? dist.tarball : typeof rec.tarball === 'string' ? rec.tarball : ''
  if (!/^sha(?:1|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) return null
  if (!tarball) return null
  const bundled = rec.bundleDependencies ?? rec.bundledDependencies
  if (Array.isArray(bundled) && bundled.length > 0) return null
  const license = typeof rec.license === 'string'
    ? rec.license
    : typeof asRecord(rec.license)?.type === 'string'
      ? String(asRecord(rec.license)?.type)
      : undefined
  const scripts = asRecord(rec.scripts)
  const scriptInstall = !!scripts && ['preinstall', 'install', 'postinstall'].some((key) => {
    const script = scripts[key]
    return typeof script === 'string' && script.length > 0
  })
  // A packument already normalized on a previous pass keeps its flag.
  const hasInstallScript = scriptInstall || rec.hasInstallScript === true
  const funding = rec.funding
  if (funding != null && (typeof funding === 'function' || typeof funding === 'symbol')) return null
  const deprecated = typeof rec.deprecated === 'string' ? rec.deprecated : undefined
  return {
    name,
    version,
    dependencies,
    optionalDependencies,
    peerDependencies,
    peerDependenciesMeta,
    ...(bin && Object.keys(bin).length ? { bin } : {}),
    ...(engines && Object.keys(engines).length ? { engines } : {}),
    ...(os && os.length ? { os } : {}),
    ...(cpu && cpu.length ? { cpu } : {}),
    ...(funding != null ? { funding } : {}),
    ...(deprecated ? { deprecated } : {}),
    hasInstallScript,
    ...(license ? { license } : {}),
    integrity,
    tarball,
  }
}

function peerMeta(raw: unknown): Record<string, { optional?: boolean }> | null {
  if (raw == null) return {}
  const rec = asRecord(raw)
  if (!rec) return null
  const out: Record<string, { optional?: boolean }> = {}
  for (const [key, value] of Object.entries(rec)) {
    const meta = asRecord(value)
    if (!meta) return null
    out[key] = meta.optional === true ? { optional: true } : {}
  }
  return out
}

function normalizeBin(bin: unknown, name: string): Record<string, string> | null {
  if (typeof bin === 'string' && bin.length > 0) {
    const short = name.startsWith('@') ? name.slice(name.lastIndexOf('/') + 1) : name
    return short ? { [short]: bin } : null
  }
  return stringMap(bin)
}

function registryTarball(name: string, version: string, tarball: string): boolean {
  let url: URL
  try {
    url = new URL(tarball)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') return false
  const slash = name.lastIndexOf('/')
  const unscoped = name.startsWith('@') ? name.slice(slash + 1) : name
  if (!url.pathname.endsWith(`/${unscoped}-${version}.tgz`)) return false
  if (!name.startsWith('@')) return true
  const scope = name.slice(0, slash)
  return url.pathname.includes(`/${scope}/`)
}

/** Fetch one published version. Null on any failure, including a tarball that is not the public registry. */
export async function fetchNpmPackument(
  name: string,
  version: string,
  timeoutMs = 8000,
): Promise<NpmPackument | null> {
  if (!SAFE_NAME.test(name) || !SAFE_VERSION.test(version)) return null
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      { headers: { accept: 'application/json' }, signal: ac.signal },
    )
    if (!res.ok) return null
    const doc = toPackument(await res.json(), name, version)
    if (!doc || !registryTarball(name, version, doc.tarball)) return null
    return doc
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

interface Requirement {
  name: string
  range: string
  optionalPeer: boolean
}

function requirements(doc: NpmPackument): Requirement[] | null {
  const out: Requirement[] = []
  for (const [name, range] of Object.entries(doc.dependencies)) out.push({ name, range, optionalPeer: false })
  for (const [name, range] of Object.entries(doc.optionalDependencies)) {
    out.push({ name, range, optionalPeer: false })
  }
  for (const [name, range] of Object.entries(doc.peerDependencies)) {
    const optional = doc.peerDependenciesMeta[name]?.optional === true
    out.push({ name, range, optionalPeer: optional })
  }
  return out
}

function metaFields(doc: NpmPackument): Json {
  const out: Json = {
    version: doc.version,
    resolved: doc.tarball,
    integrity: doc.integrity,
  }
  if (doc.license) out.license = doc.license
  if (doc.bin) out.bin = doc.bin
  if (doc.engines) out.engines = doc.engines
  if (doc.os) out.os = doc.os
  if (doc.cpu) out.cpu = doc.cpu
  if (doc.funding != null) out.funding = doc.funding
  if (doc.deprecated) out.deprecated = doc.deprecated
  if (doc.hasInstallScript) out.hasInstallScript = true
  if (Object.keys(doc.dependencies).length) out.dependencies = doc.dependencies
  if (Object.keys(doc.optionalDependencies).length) out.optionalDependencies = doc.optionalDependencies
  if (Object.keys(doc.peerDependencies).length) out.peerDependencies = doc.peerDependencies
  if (Object.keys(doc.peerDependenciesMeta).length) out.peerDependenciesMeta = doc.peerDependenciesMeta
  return out
}

const EDGE_KEYS = ['dev', 'optional', 'peer', 'devOptional', 'link', 'extraneous', 'inBundle', 'name']

function rebuildEntry(old: Json, doc: NpmPackument): Json {
  const next: Json = {}
  for (const key of EDGE_KEYS) if (key in old) next[key] = old[key]
  return { ...next, ...metaFields(doc) }
}

function stringifyLock(lock: unknown, original: string): string {
  let spaces = 2
  const match = original.match(/\n( +)"/)
  if (match && match[1].length > 0 && match[1].length <= 8) spaces = match[1].length
  let text = JSON.stringify(lock, null, spaces)
  const crlf = original.includes('\r\n')
  if (crlf) text = text.replace(/\n/g, '\r\n')
  if ((original.endsWith('\n') || original.endsWith('\r\n')) && !text.endsWith('\n')) {
    text += crlf ? '\r\n' : '\n'
  }
  return text
}

interface SpecEdit {
  key: string
  section: 'dependencies' | 'devDependencies' | 'optionalDependencies'
  name: string
  spec: string
}

/**
 * Rewrite one npm lockfile. When a registry document is missing, `need` lists
 * the versions to fetch; the caller retries. Any other failure means the lock
 * must be left unchanged.
 */
export function applyNpmLockUpdates(
  lockText: string,
  edits: ManifestEdit[],
  packuments: ReadonlyMap<string, NpmPackument | unknown>,
  availableVersions: Record<string, string>,
): ApplyResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(lockText)
  } catch {
    return { ok: false, reason: 'lockfile is not valid JSON' }
  }
  const lock = asRecord(parsed)
  if (!lock) return { ok: false, reason: 'lockfile is not an object' }
  const lockVersion = typeof lock.lockfileVersion === 'number' ? lock.lockfileVersion : Number(lock.lockfileVersion)
  if (lockVersion !== 2 && lockVersion !== 3) {
    return { ok: false, reason: `lockfileVersion ${String(lock.lockfileVersion)} is not updated` }
  }
  const packages = asRecord(lock.packages)
  if (!packages) return { ok: false, reason: 'lockfile has no packages map' }

  const forced = new Map<string, string>()
  for (const edit of edits) {
    for (const [name, version] of Object.entries(edit.versions)) {
      if (!SAFE_VERSION.test(version)) return { ok: false, reason: `${name}@${version} is not a plain version` }
      const previous = forced.get(name)
      if (previous && previous !== version) return { ok: false, reason: `${name} is bumped to both ${previous} and ${version}` }
      forced.set(name, version)
    }
  }

  const specEdits: SpecEdit[] = []
  const planned = new Map<string, Plan>()
  for (const edit of edits) {
    const key = manifestKey(edit.path)
    if (key == null) return { ok: false, reason: `${edit.path} is not a package.json path` }
    const manifest = asRecord(packages[key])
    if (!manifest || isLink(manifest)) return { ok: false, reason: `lock has no package entry for ${edit.path}` }
    const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
    for (const section of sections) {
      const specs = edit.sections[section]
      if (!specs) continue
      for (const [name, spec] of Object.entries(specs)) {
        const target = edit.versions[name]
        if (!target) return { ok: false, reason: `${name} has no target version` }
        if (!satisfiesRange(target, spec)) return { ok: false, reason: `${target} does not satisfy ${spec}` }
        const resolved = resolveLockPath(key, name, packages)
        if (!resolved) return { ok: false, reason: `lock has no installed ${name} for ${edit.path}` }
        const entry = asRecord(packages[resolved])
        if (!entry || isLink(entry)) return { ok: false, reason: `${name} is not a registry entry in the lock` }
        specEdits.push({ key, section, name, spec })
        const current = entryVersion(entry)
        if (current === target || satisfiesRange(current, spec)) continue
        const existing = planned.get(resolved)
        if (existing && existing.version !== target) {
          return { ok: false, reason: `${resolved} would need both ${existing.version} and ${target}` }
        }
        if (!existing) planned.set(resolved, { name, version: target, oldVersion: current })
      }
    }
  }

  const targetOf = (name: string): string | undefined => forced.get(name) ?? availableVersions[name]

  for (let guard = 0; guard < 32; guard++) {
    const missing: Array<{ name: string; version: string }> = []
    for (const plan of planned.values()) {
      if (!lookupPackument(packuments, plan.name, plan.version)) missing.push({ name: plan.name, version: plan.version })
    }
    if (missing.length) return { ok: false, reason: 'need-packuments', need: dedupeNeeds(missing) }

    let added = false
    for (const [path, plan] of [...planned.entries()]) {
      const doc = lookupPackument(packuments, plan.name, plan.version)
      if (!doc) return { ok: false, reason: `missing registry metadata for ${plan.name}@${plan.version}` }
      const reqs = requirements(doc)
      if (!reqs) return { ok: false, reason: `${plan.name}@${plan.version} has an unreadable dependency map` }
      for (const req of reqs) {
        if (req.optionalPeer) continue
        const resolved = resolveLockPath(path, req.name, packages)
        if (!resolved) {
          return { ok: false, reason: `${plan.name}@${plan.version} needs ${req.name}@${req.range}, which is not in the lock` }
        }
        const entry = asRecord(packages[resolved])
        if (!entry || isLink(entry)) {
          return { ok: false, reason: `${req.name} is not a registry entry in the lock` }
        }
        const plannedVersion = planned.get(resolved)?.version ?? entryVersion(entry)
        if (satisfiesRange(plannedVersion, req.range)) continue
        const next = targetOf(req.name)
        if (!next || !SAFE_VERSION.test(next) || !satisfiesRange(next, req.range)) {
          return {
            ok: false,
            reason: `${req.name}@${plannedVersion} does not satisfy ${req.range} from ${plan.name}@${plan.version}`,
          }
        }
        const oldVersion = entryVersion(entry)
        if (majorJumpTooFar(next, oldVersion)) {
          return { ok: false, reason: `refusing to move ${req.name} from ${oldVersion} to ${next}` }
        }
        const existing = planned.get(resolved)
        if (existing && existing.version !== next) {
          return { ok: false, reason: `${resolved} would need both ${existing.version} and ${next}` }
        }
        if (!existing) {
          planned.set(resolved, { name: req.name, version: next, oldVersion })
          added = true
        }
      }
    }
    if (!added) break
  }

  for (const [path, plan] of planned) {
    const doc = lookupPackument(packuments, plan.name, plan.version)
    if (!doc) return { ok: false, reason: `missing registry metadata for ${plan.name}@${plan.version}` }
    const reqs = requirements(doc)
    if (!reqs) return { ok: false, reason: `${plan.name}@${plan.version} has an unreadable dependency map` }
    for (const req of reqs) {
      if (req.optionalPeer) continue
      const resolved = resolveLockPath(path, req.name, packages)
      const entry = resolved ? asRecord(packages[resolved]) : null
      const plannedVersion = resolved ? (planned.get(resolved)?.version ?? (entry ? entryVersion(entry) : '')) : ''
      if (!resolved || !entry || isLink(entry) || !satisfiesRange(plannedVersion, req.range)) {
        return {
          ok: false,
          reason: `${plan.name}@${plan.version} needs ${req.name}@${req.range}, which the lock does not resolve`,
        }
      }
    }
  }

  for (const [path, plan] of planned) {
    for (const [fromKey, raw] of Object.entries(packages)) {
      const node = asRecord(raw)
      if (!node || isLink(node)) continue
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
        const range = effectiveRange(fromKey, node, section, plan.name, specEdits, planned, packuments)
        if (range === INVALID_RANGE) return { ok: false, reason: 'a lock dependency map is unreadable' }
        if (range == null) continue
        const resolved = resolveLockPath(fromKey, plan.name, packages)
        if (resolved !== path) continue
        if (!satisfiesRange(plan.version, range)) {
          const where = fromKey || 'the root package'
          return { ok: false, reason: `${plan.name}@${plan.version} does not satisfy ${range} required by ${where}` }
        }
      }
    }
  }

  for (const edit of specEdits) {
    const node = asRecord(packages[edit.key])
    if (!node) return { ok: false, reason: `lock lost ${edit.key || 'the root package'}` }
    const section = asRecord(node[edit.section]) ?? {}
    section[edit.name] = edit.spec
    node[edit.section] = section
  }

  for (const [path, plan] of planned) {
    const doc = lookupPackument(packuments, plan.name, plan.version)
    const entry = asRecord(packages[path])
    if (!doc || !entry) return { ok: false, reason: `missing registry metadata for ${plan.name}@${plan.version}` }
    packages[path] = rebuildEntry(entry, doc)
  }

  if (lockVersion === 2) {
    const legacyError = syncLegacyTree(lock, packages, planned, packuments)
    if (legacyError) return { ok: false, reason: legacyError }
  }

  return { ok: true, text: stringifyLock(lock, lockText) }
}

function dedupeNeeds(needs: Array<{ name: string; version: string }>): Array<{ name: string; version: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string; version: string }> = []
  for (const need of needs) {
    const id = `${need.name}@${need.version}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(need)
  }
  return out
}

function lookupPackument(
  packuments: ReadonlyMap<string, NpmPackument | unknown>,
  name: string,
  version: string,
): NpmPackument | null {
  if (!packuments.has(`${name}@${version}`)) return null
  return toPackument(packuments.get(`${name}@${version}`), name, version)
}

const INVALID_RANGE = '\0'

function effectiveRange(
  fromKey: string,
  node: Json,
  section: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies',
  depName: string,
  specEdits: SpecEdit[],
  planned: Map<string, Plan>,
  packuments: ReadonlyMap<string, NpmPackument | unknown>,
): string | null {
  if (section !== 'peerDependencies') {
    const spec = specEdits.find((edit) => edit.key === fromKey && edit.section === section && edit.name === depName)
    if (spec) return spec.spec
  }
  const plan = planned.get(fromKey)
  if (plan) {
    if (section === 'devDependencies') return null
    const doc = lookupPackument(packuments, plan.name, plan.version)
    if (!doc) return null
    const map = section === 'peerDependencies'
      ? doc.peerDependencies
      : section === 'optionalDependencies'
        ? doc.optionalDependencies
        : doc.dependencies
    return map[depName] ?? null
  }
  if (node[section] == null) return null
  const map = stringMap(node[section])
  if (!map) return INVALID_RANGE
  return map[depName] ?? null
}

function syncLegacyTree(
  lock: Json,
  packages: Json,
  planned: Map<string, Plan>,
  packuments: ReadonlyMap<string, NpmPackument | unknown>,
): string | null {
  const root = asRecord(lock.dependencies)
  if (!root) return 'lockfileVersion 2 has no dependencies tree'
  const targets: Array<{ node: Json; plan: Plan }> = []
  for (const [packagesKey, plan] of planned) {
    const chain = nodeModulesChain(packagesKey)
    if (chain) {
      const node = legacyAt(root, chain)
      if (!node) return `legacy lock tree has no entry for ${packagesKey}`
      targets.push({ node, plan })
      continue
    }
    const name = packageNameFromKey(packagesKey)
    if (!name) return `cannot map ${packagesKey} into the legacy lock tree`
    const matches: Json[] = []
    walkLegacy(root, (childName, node) => {
      if (childName === name && node.version === plan.oldVersion) matches.push(node)
    })
    if (matches.length === 0) continue
    const siblings = Object.entries(packages).filter(([key, value]) => {
      const entry = asRecord(value)
      return !!entry && !isLink(entry) && packageNameFromKey(key) === name && entry.version === plan.oldVersion
    })
    const allMoved = siblings.every(([key]) => planned.get(key)?.version === plan.version)
    if (!allMoved) return `legacy ${name}@${plan.oldVersion} is still required at that version`
    for (const node of matches) targets.push({ node, plan })
  }

  const applied = new Map<Json, string>()
  for (const target of targets) {
    const previous = applied.get(target.node)
    if (previous && previous !== target.plan.version) {
      return `legacy entry would need both ${previous} and ${target.plan.version}`
    }
    if (previous) continue
    const doc = lookupPackument(packuments, target.plan.name, target.plan.version)
    if (!doc) return `missing registry metadata for ${target.plan.name}@${target.plan.version}`
    applyLegacyNode(target.node, doc)
    applied.set(target.node, target.plan.version)
  }
  for (const [node] of applied) {
    const error = validateLegacyNode(node)
    if (error) return error
  }
  return null
}

function legacyAt(root: Json, chain: string[]): Json | null {
  let cursor: Json | null = root
  let node: Json | null = null
  for (const name of chain) {
    if (!cursor) return null
    node = asRecord(cursor[name])
    if (!node) return null
    cursor = asRecord(node.dependencies)
  }
  return node
}

function walkLegacy(root: Json, visit: (name: string, node: Json) => void): void {
  for (const [name, raw] of Object.entries(root)) {
    const node = asRecord(raw)
    if (!node) continue
    visit(name, node)
    const nested = asRecord(node.dependencies)
    if (nested) walkLegacy(nested, visit)
  }
}

function applyLegacyNode(node: Json, doc: NpmPackument): void {
  const nested = asRecord(node.dependencies)
  const flags: Json = {}
  for (const key of ['dev', 'optional', 'peer', 'devOptional', 'extraneous', 'inBundle']) {
    if (key in node) flags[key] = node[key]
  }
  for (const key of Object.keys(node)) delete node[key]
  const meta = metaFields(doc)
  delete meta.dependencies
  delete meta.optionalDependencies
  Object.assign(node, flags, meta)
  const requires = { ...doc.dependencies, ...doc.optionalDependencies }
  if (Object.keys(requires).length) node.requires = requires
  if (nested) {
    for (const key of Object.keys(nested)) {
      if (!(key in requires)) delete nested[key]
    }
    if (Object.keys(nested).length) node.dependencies = nested
  }
}

function validateLegacyNode(node: Json): string | null {
  const requires = stringMap(node.requires) ?? {}
  const nested = asRecord(node.dependencies)
  if (!nested) return null
  for (const [name, raw] of Object.entries(nested)) {
    const child = asRecord(raw)
    if (!child) return `legacy tree nests ${name}, which is not an object`
    const range = requires[name]
    if (!range) return `legacy tree still nests removed dependency ${name}`
    const version = typeof child.version === 'string' ? child.version : ''
    if (!satisfiesRange(version, range)) {
      return `legacy tree nests ${name}@${version}, which does not satisfy ${range}`
    }
  }
  return null
}

export function editsFromUpdatedManifests(
  files: Array<{ path: string; contents: string }>,
  bumps: BumpRef[],
): ManifestEdit[] | null {
  const byPath = new Map<string, BumpRef[]>()
  for (const bump of bumps) {
    if (!bump.path) continue
    const list = byPath.get(bump.path) ?? []
    list.push(bump)
    byPath.set(bump.path, list)
  }
  const edits: ManifestEdit[] = []
  for (const file of files) {
    const mine = byPath.get(file.path)
    if (!mine) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(file.contents)
    } catch {
      return null
    }
    const pkg = asRecord(parsed)
    if (!pkg) return null
    const versions: Record<string, string> = {}
    const sections: ManifestEdit['sections'] = {}
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      if (pkg[section] == null) continue
      const map = stringMap(pkg[section])
      if (!map) return null
      const picked: Record<string, string> = {}
      for (const bump of mine) {
        if (!(bump.package in map)) continue
        picked[bump.package] = map[bump.package]
        versions[bump.package] = bump.to
      }
      if (Object.keys(picked).length) sections[section] = picked
    }
    if (Object.keys(versions).length) edits.push({ path: file.path, sections, versions })
  }
  return edits
}

export function decodeBase64Utf8(encoded: string): string | null {
  try {
    const bin = atob(encoded.replace(/\s/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function interpretGithubContent(
  payload: unknown,
): { kind: 'text'; text: string } | { kind: 'blob'; sha: string } | { kind: 'missing' } {
  const obj = asRecord(payload)
  if (!obj) return { kind: 'missing' }
  const size = typeof obj.size === 'number' ? obj.size : 0
  if (size > MAX_LOCK_BYTES) return { kind: 'missing' }
  const content = typeof obj.content === 'string' ? obj.content : ''
  const encoding = typeof obj.encoding === 'string' ? obj.encoding : ''
  if (content.trim() && encoding !== 'none') {
    const text = decodeBase64Utf8(content)
    return text == null ? { kind: 'missing' } : { kind: 'text', text }
  }
  if (typeof obj.sha === 'string' && /^[a-f0-9]{40}$/.test(obj.sha) && size > 0) {
    return { kind: 'blob', sha: obj.sha }
  }
  return { kind: 'missing' }
}

/** Read a repo file. Files over 1 MB come back from the Git blobs API. */
export async function loadGithubFileText(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  headers: Record<string, string>,
  ghFetchOptional: (url: string, init: RequestInit) => Promise<unknown | null>,
): Promise<string | null> {
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  const encoded = path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const payload = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    { headers },
  )
  const first = interpretGithubContent(payload)
  if (first.kind === 'text') return first.text
  if (first.kind !== 'blob') return null
  const blob = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${first.sha}`,
    { headers },
  )
  const second = interpretGithubContent(blob)
  return second.kind === 'text' ? second.text : null
}

export interface NpmLockPlan {
  files: FileChange[]
  /** True when every npm lockfile that governs a bumped manifest was updated. */
  complete: boolean
  reasons: string[]
}

/**
 * Read the npm lockfiles for the bumped manifests, fetch registry metadata,
 * and either return updated lockfile contents or a reason the lock was left
 * unchanged. One lockfile is all-or-nothing; a repo with several is too.
 */
export async function planNpmLockfileUpdates(input: {
  manifests: Array<{ path: string; contents: string }>
  bumps: BumpRef[]
  availableVersions: Record<string, string>
  readText: (path: string) => Promise<string | null>
  fetchPackument: (name: string, version: string) => Promise<NpmPackument | null>
}): Promise<NpmLockPlan> {
  const edits = editsFromUpdatedManifests(input.manifests, input.bumps)
  if (!edits) return { files: [], complete: false, reasons: ['updated package.json could not be read'] }
  if (edits.length === 0) return { files: [], complete: false, reasons: [] }

  const cache = new Map<string, Promise<string | null>>()
  const read = (path: string) => {
    let pending = cache.get(path)
    if (!pending) {
      pending = input.readText(path)
      cache.set(path, pending)
    }
    return pending
  }

  const groups = new Map<string, ManifestEdit[]>()
  for (const edit of edits) {
    let dir = directoryOf(edit.path)
    const seen = new Set<string>()
    let found: string[] = []
    while (!seen.has(dir)) {
      seen.add(dir)
      const hits: string[] = []
      for (const name of ['npm-shrinkwrap.json', 'package-lock.json']) {
        const lockPath = joinPath(dir, name)
        if (await read(lockPath)) hits.push(lockPath)
      }
      if (hits.length) {
        found = hits
        break
      }
      if (dir === '.') break
      dir = parentDirectory(dir)
    }
    for (const lockPath of found) {
      const list = groups.get(lockPath) ?? []
      list.push(edit)
      groups.set(lockPath, list)
    }
  }
  if (groups.size === 0) return { files: [], complete: false, reasons: [] }

  const files: FileChange[] = []
  const reasons: string[] = []
  for (const [lockPath, group] of groups) {
    const text = await read(lockPath)
    if (!text) {
      reasons.push(`${lockPath} could not be read`)
      continue
    }
    const packs = new Map<string, NpmPackument>()
    let result = applyNpmLockUpdates(text, group, packs, input.availableVersions)
    for (let round = 0; round < 8 && !result.ok && result.need; round++) {
      let fetched = false
      let registryMiss = false
      for (const need of result.need) {
        const id = `${need.name}@${need.version}`
        if (packs.has(id)) continue
        const doc = await input.fetchPackument(need.name, need.version)
        if (!doc) {
          result = { ok: false, reason: `registry has no usable ${id}` }
          registryMiss = true
          break
        }
        packs.set(id, doc)
        fetched = true
      }
      if (registryMiss || !fetched) break
      result = applyNpmLockUpdates(text, group, packs, input.availableVersions)
    }
    if (!result.ok) {
      reasons.push(`${lockPath}: ${result.reason}`)
      continue
    }
    files.push({
      path: lockPath,
      contents: result.text,
      reason: 'refresh npm lock entries for @mushi-mushi/*',
    })
  }
  const complete = reasons.length === 0 && files.length === groups.size && files.length > 0
  return { files: complete ? files : [], complete, reasons }
}
