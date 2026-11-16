/**
 * FILE: scripts/check-minimatch-version.test.mjs
 * PURPOSE: Lock the minimatch 10.x override to a release that closes
 *          GHSA-g3hv-75wg-m249 and the later holes on that same line.
 *
 * OVERVIEW:
 * - GHSA-g3hv-75wg-m249 (CVE-2026-118764) covers minimatch >=7.0.0 <11.0.1.
 *   This repo resolves that range as minimatch 10.2.5 (eslint, glob 11 and
 *   13, typescript-eslint, @expo/fingerprint, @ts-morph/common).
 * - 11.0.1 is the first fix for that advisory. 11.0.0–11.0.6 also have
 *   GHSA-cf2h-pxjq-68xw, 11.0.3–11.0.7 have GHSA-hqmv-qgp3-jx75, and
 *   >=7.4.0 <=11.0.7 have GHSA-c859-jr93-m5j4. 11.0.8 closes all four.
 * - 3.1.5 and 5.1.9 stay. Both ranges start at 7.x. glob@7 and filelist call
 *   the legacy function export; 11 exports that function as `.minimatch`.
 * - The install check follows symlinks from dependents in node_modules/.pnpm.
 *   A minimatch directory left behind by an older install, with nothing
 *   linking to it, is not a failure.
 *
 * DEPENDENCIES: node:test, node:fs, scripts/check-dependency-overrides.mjs
 * USAGE: node --test scripts/check-minimatch-version.test.mjs
 *        (also listed in the root `test:scripts` script)
 *
 * NOTES: The floor is 11.0.8, above the report's 11.0.1, because 11.0.1
 *        is still inside the later advisories. A test that the resolved
 *        version is that release is enough; this file does not reproduce
 *        the advisories. pnpm-workspace.yaml may exempt minimatch@11.0.8
 *        from the release cooldown until 2026-11-18. This file does not
 *        require that line.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [11, 0, 8]
const CEILING = [12, 0, 0]
const OVERRIDE = '>=11.0.8 <12'
const COOLDOWN_EXEMPTION = "  - 'minimatch@11.0.8'"

function parseVersion(spec) {
  const match = String(spec).match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(left, right) {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

/** Versions on the vulnerable line (>=7) must be 11.0.8 or a later 11.x. */
function assertPatched(version, where) {
  const parsed = parseVersion(version)
  assert.ok(parsed, `${where}: ${version} is not a version`)
  if (parsed[0] < 7) return
  assert.ok(compare(parsed, FLOOR) >= 0, `${where}: ${version} is below 11.0.8`)
  assert.ok(compare(parsed, CEILING) < 0, `${where}: ${version} is outside 11.x`)
}

function resolvedVersions(lock) {
  const versions = new Set()
  for (const match of lock.matchAll(/^ {2}minimatch@(\d+\.\d+\.\d+)(?:\(|:)/gm)) {
    versions.add(match[1])
  }
  for (const match of lock.matchAll(/^ {6}minimatch: (\d+\.\d+\.\d+)$/gm)) {
    versions.add(match[1])
  }
  return versions
}

/** pnpm directory name `minimatch@11.0.8_brace-expansion@5.0.12` → `11.0.8`. */
export function minimatchStoreVersion(dir) {
  if (!dir.startsWith('minimatch@')) return null
  const version = dir.slice('minimatch@'.length).split('(')[0].split('_')[0]
  return parseVersion(version) ? version : null
}

/**
 * Virtual-store directories a dependent actually links to.
 * `storeDirs` is the `.pnpm` listing. `links` are `{ from, target }`
 * where `target` is a `minimatch@…` directory. A package's own directory
 * (`from` starting with `minimatch@`) is not a dependent, so a cached
 * copy nothing else links to is left out.
 */
export function reachableMinimatchDirs(storeDirs, links) {
  const present = new Set(storeDirs)
  const seen = new Set()
  const dirs = []
  for (const link of links) {
    if (!link || typeof link.from !== 'string' || typeof link.target !== 'string') continue
    if (link.from.startsWith('minimatch@')) continue
    if (!link.target.startsWith('minimatch@') || !present.has(link.target)) continue
    if (seen.has(link.target)) continue
    seen.add(link.target)
    dirs.push(link.target)
  }
  return dirs
}

/**
 * Symlinks from installed packages onto a minimatch directory.
 * Does not stat `minimatch@*` directories: those are the packages themselves,
 * and pnpm retains them after the last dependent is gone.
 */
export function readMinimatchLinks(store, names, fs = {}) {
  const exists = fs.exists ?? existsSync
  const realpath = fs.realpath ?? realpathSync
  let root = store
  try {
    root = realpath(store)
  } catch {
    root = store
  }
  const links = []
  const push = (from, linkPath) => {
    if (!exists(linkPath)) return
    let real
    try {
      real = realpath(linkPath)
    } catch {
      return
    }
    const target = path.relative(root, real).split(path.sep)[0]
    if (!target.startsWith('minimatch@')) return
    links.push({ from, target })
  }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('minimatch@')) continue
    push(name, path.join(store, name, 'node_modules', 'minimatch'))
  }
  push('node_modules', path.join(store, 'node_modules', 'minimatch'))
  return links
}

/** Drops the temporary minimumReleaseAgeExclude entry for minimatch 11.0.8. */
export function withoutCooldownExemption(workspace) {
  return workspace
    .split(/\r?\n/)
    .filter((line) => line !== COOLDOWN_EXEMPTION)
    .join('\n')
}

test('the minimatch 10 override is a bounded 11.0.8 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const range = pkg.pnpm?.overrides?.['minimatch@10']
  assert.equal(range, OVERRIDE)
  assert.equal(isBounded(range), true)
})

test('the security fix does not require the temporary cooldown exemption', () => {
  const fixture = "minimumReleaseAgeExclude:\n  - 'minimatch@11.0.8'\n  - 'nanoid'\n"
  assert.equal(
    withoutCooldownExemption(fixture),
    "minimumReleaseAgeExclude:\n  - 'nanoid'\n",
  )
  const workspace = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  assert.equal(withoutCooldownExemption(workspace).includes(COOLDOWN_EXEMPTION), false)

  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.equal(pkg.pnpm?.overrides?.['minimatch@10'], OVERRIDE)
  assert.equal(isBounded(pkg.pnpm.overrides['minimatch@10']), true)
  assert.match(lock, /^ {2}minimatch@10: '>=11\.0\.8 <12'$/m)
  const versions = resolvedVersions(lock)
  assert.equal(versions.has('10.2.5'), false)
  for (const version of versions) assertPatched(version, 'lockfile')
  assert.ok(
    [...versions].some((version) => parseVersion(version)[0] >= 7),
    'expected a minimatch 11.x install',
  )

  // The exemption line is removed after 2026-11-18. Requiring it here would
  // fail the suite on that day. The string is assembled so this assertion
  // does not itself contain the call it forbids.
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const requiresExemption = ['assert.match', '(workspace,'].join('')
  assert.equal(source.includes(requiresExemption), false)
})

test('pnpm-lock.yaml resolves minimatch 10.x to 11.0.8 or a later 11.x', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}minimatch@10: '>=11\.0\.8 <12'$/m)
  const versions = resolvedVersions(lock)
  assert.ok(versions.size > 0, 'expected minimatch to stay installed')
  assert.equal(versions.has('10.2.5'), false)
  for (const version of versions) assertPatched(version, 'lockfile')
  const modern = [...versions].filter((version) => parseVersion(version)[0] >= 7)
  assert.ok(modern.length > 0, 'expected a minimatch 11.x install')
})

test('a cached minimatch directory no package links to is ignored', () => {
  const storeDirs = [
    'minimatch@11.0.8',
    'minimatch@11.0.8_brace-expansion@5.0.12',
    'minimatch@10.2.5',
    'minimatch@10.2.5_brace-expansion@1.1.21',
    'minimatch@3.1.5',
    'minimatch@5.1.9',
    'eslint@10.6.0_jiti@2.7.0',
    'glob@13.0.6',
    'glob@7.2.3',
    'filelist@1.0.6',
  ]
  const links = [
    { from: 'eslint@10.6.0_jiti@2.7.0', target: 'minimatch@11.0.8' },
    { from: 'glob@13.0.6', target: 'minimatch@11.0.8_brace-expansion@5.0.12' },
    { from: 'glob@7.2.3', target: 'minimatch@3.1.5' },
    { from: 'filelist@1.0.6', target: 'minimatch@5.1.9' },
    { from: 'minimatch@10.2.5', target: 'minimatch@10.2.5' },
  ]
  const dirs = reachableMinimatchDirs(storeDirs, links)
  assert.deepEqual(dirs, [
    'minimatch@11.0.8',
    'minimatch@11.0.8_brace-expansion@5.0.12',
    'minimatch@3.1.5',
    'minimatch@5.1.9',
  ])
  for (const dir of dirs) assertPatched(minimatchStoreVersion(dir), dir)
})

test('a dependent still linked to a vulnerable minimatch is rejected', () => {
  const dirs = reachableMinimatchDirs(
    ['minimatch@10.2.5', 'minimatch@11.0.8'],
    [{ from: 'eslint@10.6.0_jiti@2.7.0', target: 'minimatch@10.2.5' }],
  )
  assert.deepEqual(dirs, ['minimatch@10.2.5'])
  assert.throws(
    () => assertPatched(minimatchStoreVersion(dirs[0]), dirs[0]),
    /below 11\.0\.8/,
  )
})

test('reading the virtual store skips a cached minimatch nothing links to', () => {
  const store = path.join('/virtual', 'node_modules', '.pnpm')
  const names = [
    'minimatch@11.0.8',
    'minimatch@10.2.5',
    'eslint@10.6.0_jiti@2.7.0',
    'node_modules',
  ]
  const eslintLink = path.join(store, 'eslint@10.6.0_jiti@2.7.0', 'node_modules', 'minimatch')
  const hoistLink = path.join(store, 'node_modules', 'minimatch')
  const cached = path.join(store, 'minimatch@10.2.5', 'node_modules', 'minimatch')
  const modern = path.join(store, 'minimatch@11.0.8', 'node_modules', 'minimatch')
  const present = new Set([eslintLink, hoistLink, cached, modern])
  const checked = []
  const links = readMinimatchLinks(store, names, {
    exists: (candidate) => {
      checked.push(candidate)
      return present.has(candidate)
    },
    realpath: (candidate) => {
      if (candidate === eslintLink || candidate === hoistLink) return modern
      if (candidate === cached) return cached
      throw new Error(candidate)
    },
  })
  const cachedPrefix = `${path.sep}minimatch@10.2.5${path.sep}`
  assert.equal(checked.some((candidate) => candidate.includes(cachedPrefix)), false)
  const dirs = reachableMinimatchDirs(names, links)
  assert.deepEqual(dirs, ['minimatch@11.0.8'])
  for (const dir of dirs) assertPatched(minimatchStoreVersion(dir), dir)
})

test('installed minimatch copies reachable from dependents are patched and still match a literal glob', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const names = readdirSync(store)
  const links = readMinimatchLinks(store, names)
  const dirs = reachableMinimatchDirs(
    names.concat(['minimatch@10.2.5', 'minimatch@10.2.5_brace-expansion@1.1.21']),
    links,
  )
  assert.ok(dirs.length > 0, 'installed graph has no minimatch package')
  const require = createRequire(import.meta.url)
  let checkedModern = false
  for (const dir of dirs) {
    const version = minimatchStoreVersion(dir)
    assertPatched(version, 'node_modules/.pnpm')
    const manifest = path.join(store, dir, 'node_modules', 'minimatch', 'package.json')
    if (!existsSync(manifest)) continue
    const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
    assertPatched(installed, manifest)
    if (parseVersion(installed)[0] < 7) continue
    checkedModern = true
    const loaded = require(path.join(store, dir, 'node_modules', 'minimatch'))
    assert.equal(typeof loaded.Minimatch, 'function')
    assert.equal(typeof loaded.minimatch, 'function')
    const matcher = new loaded.Minimatch('src/*.js', { dot: true })
    assert.equal(matcher.match('src/a.js'), true)
    assert.equal(matcher.match('lib/a.js'), false)
    assert.equal(loaded.minimatch('src/a.js', 'src/*.js'), true)
  }
  assert.equal(checkedModern, true)
})
