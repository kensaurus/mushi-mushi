/**
 * FILE: _shared/lockfiles/poetry.ts
 * PURPOSE: poetry.lock → resolved PyPI packages with their dev flag.
 *
 * Each `[[package]]` has `name` and `version`. The dev flag comes from the
 * lock when it records one: `groups = ["main", "dev"]` (Poetry 2, lock 2.1;
 * dev unless "main" is listed) or `category = "dev"` (Poetry before 1.2,
 * lock 1.x). Poetry 1.2 to 1.8 (lock 2.0) records neither, so production is
 * the closure of pyproject.toml's production names over each package's
 * `[package.dependencies]` (optional ones included: an extra a production
 * package asks for is installed). Names are PEP 503 normalised. Packages
 * whose `[package.source]` is git, a directory, a file or a URL are skipped;
 * a private index (`legacy`) is kept.
 */

import { dedupePackages, normalizePypiName, reachable, type LockfileParse, type Manifests, type ResolvedPackage } from './types.ts'
import { arrayAt, parseTomlLite, tableAt, type TomlTable } from './toml-lite.ts'
import { EXACT_PEP440, pyprojectDeps } from './pyproject.ts'

const LOCAL_SOURCES = new Set(['git', 'directory', 'file', 'url'])

export function parsePoetryLock(text: string, manifests: Manifests = {}): LockfileParse {
  const warnings: string[] = []
  let doc: TomlTable
  try {
    doc = parseTomlLite(text)
  } catch {
    return { kind: 'poetry', ecosystem: 'PyPI', packages: [], warnings: ['poetry.lock could not be read.'] }
  }
  const pkgs = arrayAt(doc.package).map((p) => tableAt(p))
  if (pkgs.length === 0) warnings.push('poetry.lock lists no packages.')

  const deps = new Map<string, Set<string>>()
  for (const p of pkgs) {
    if (typeof p.name !== 'string') continue
    const name = normalizePypiName(p.name)
    const set = deps.get(name) ?? new Set<string>()
    for (const d of Object.keys(tableAt(p.dependencies))) set.add(normalizePypiName(d))
    deps.set(name, set)
  }
  const manifest = pyprojectDeps(manifests)
  const prod = reachable(manifest.prod, (n) => deps.get(n) ?? [])

  const out: ResolvedPackage[] = []
  let local = 0
  let inexact = 0
  let guessed = false
  for (const p of pkgs) {
    if (typeof p.name !== 'string' || typeof p.version !== 'string') continue
    const sourceType = tableAt(p.source).type
    if (typeof sourceType === 'string' && LOCAL_SOURCES.has(sourceType)) {
      local++
      continue
    }
    if (!EXACT_PEP440.test(p.version)) {
      inexact++
      continue
    }
    const name = normalizePypiName(p.name)
    const groups = arrayAt(p.groups).filter((g): g is string => typeof g === 'string')
    let dev: boolean
    if (groups.length > 0) dev = !groups.includes('main')
    else if (typeof p.category === 'string') dev = p.category === 'dev'
    else if (manifest.any) dev = !prod.has(name)
    else {
      dev = false
      guessed = true
    }
    out.push({ ecosystem: 'PyPI', name, version: p.version, dev, direct: manifest.prod.has(name) || manifest.dev.has(name) })
  }
  if (local > 0) warnings.push(`${local} package${local === 1 ? '' : 's'} from git, a local path or a URL skipped.`)
  if (inexact > 0) warnings.push(`${inexact} package${inexact === 1 ? '' : 's'} without an exact version skipped.`)
  if (guessed) warnings.push('No pyproject.toml was read beside poetry.lock and the lock records no groups, so dev dependencies could not be told apart; those packages count as production.')
  else if (!manifest.any && out.length > 0) warnings.push('No pyproject.toml was read beside poetry.lock, so direct dependencies could not be told apart.')
  return { kind: 'poetry', ecosystem: 'PyPI', packages: dedupePackages(out), warnings }
}
