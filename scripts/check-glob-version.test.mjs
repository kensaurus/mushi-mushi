/**
 * FILE: check-glob-version.test.mjs
 * PURPOSE: Keep GHSA-3g3m-2fjr-6pw4 (CVE-2026-118773) out of the lockfile.
 *
 * OVERVIEW:
 * - glob 11 and 13 have no patched release. 14.0.2 is the first fix.
 * - workbox-build asks for glob 11; Expo and Sentry ask for glob 13.
 * - Root pnpm.overrides move those requests onto glob 14.
 * - glob 7 stays. It is outside the advisory (>=9.0.0, <=14.0.1).
 *
 * DEPENDENCIES:
 * - node:test, node:assert, node:fs, node:module
 * - scripts/check-dependency-overrides.mjs (isBounded)
 *
 * USAGE:
 * - `node --test scripts/check-glob-version.test.mjs`
 * - Included in `pnpm test:scripts`
 *
 * TECHNICAL DETAILS:
 * - Reads package.json overrides and pnpm-lock.yaml resolutions.
 * - When node_modules is installed, checks glob copies that another
 *   installed package links, then globSync().
 * - A glob@* directory with no inbound link is a pnpm virtual-store
 *   leftover. It is not an active dependency.
 *
 * NOTES:
 * - A 14.x newer than 14.0.2 is still a fix. The ceiling stays below 15.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [14, 0, 2]
const CEILING = [15, 0, 0]
const ADVISORY_START = [9, 0, 0]
const RANGE = '>=14.0.2 <15'

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

/** True for glob >=9.0.0 and <14.0.2, the range GHSA-3g3m-2fjr-6pw4 covers. */
function isVulnerable(version) {
  const parsed = parseVersion(version)
  assert.ok(parsed, `${version} is not a version`)
  return compare(parsed, ADVISORY_START) >= 0 && compare(parsed, FLOOR) < 0
}

function assertNotVulnerable(version, where) {
  assert.equal(isVulnerable(version), false, `${where}: glob@${version} is inside GHSA-3g3m-2fjr-6pw4`)
  const parsed = parseVersion(version)
  if (compare(parsed, ADVISORY_START) >= 0) {
    assert.ok(compare(parsed, CEILING) < 0, `${where}: glob@${version} is outside 14.x`)
  }
}

/** Record one installed glob directory, following a pnpm symlink once. */
function considerGlobDir(globDir, seen, manifests) {
  if (!existsSync(globDir)) return
  let real
  try {
    real = realpathSync(globDir)
  } catch {
    return
  }
  const manifest = path.join(real, 'package.json')
  if (!existsSync(manifest) || seen.has(manifest)) return
  seen.add(manifest)
  manifests.push(manifest)
}

/**
 * Glob packages reachable from the installed dependency graph.
 * Skips glob@* store entries themselves: pnpm can leave those behind
 * after an upgrade even when nothing links them.
 */
function reachableGlobManifests(store) {
  const manifests = []
  const seen = new Set()
  let names
  try {
    names = readdirSync(store)
  } catch {
    return manifests
  }
  for (const name of names) {
    if (name.startsWith('glob@')) continue
    const globDir = name === 'node_modules'
      ? path.join(store, 'node_modules', 'glob')
      : path.join(store, name, 'node_modules', 'glob')
    considerGlobDir(globDir, seen, manifests)
  }
  considerGlobDir(path.join(store, '..', 'glob'), seen, manifests)
  return manifests
}

/** Assert every linked glob is outside the advisory. Returns the patched copies. */
function checkInstalledGlobs(store) {
  const patched = []
  for (const manifest of reachableGlobManifests(store)) {
    const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
    assertNotVulnerable(installed, manifest)
    if (compare(parseVersion(installed), FLOOR) >= 0) patched.push(manifest)
  }
  return patched
}

function makeStore() {
  const root = mkdtempSync(path.join(tmpdir(), 'mushi-glob-store-'))
  const store = path.join(root, 'node_modules', '.pnpm')
  mkdirSync(store, { recursive: true })
  return { root, store }
}

function writeGlobPackage(store, version) {
  const dir = path.join(store, `glob@${version}`, 'node_modules', 'glob')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'glob', version }))
  return dir
}

function linkGlob(store, dependent, version) {
  const linkDir = path.join(store, dependent, 'node_modules')
  mkdirSync(linkDir, { recursive: true })
  symlinkSync(path.join('..', '..', `glob@${version}`, 'node_modules', 'glob'), path.join(linkDir, 'glob'), 'dir')
}

test('the glob 11 and 13 overrides are a bounded 14.0.2 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  for (const key of ['glob@11', 'glob@13']) {
    const range = pkg.pnpm?.overrides?.[key]
    assert.equal(range, RANGE, key)
    assert.equal(isBounded(range), true, key)
  }
})

test('pnpm-lock.yaml resolves no vulnerable glob', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}glob@11: '>=14\.0\.2 <15'$/m)
  assert.match(lock, /^ {2}glob@13: '>=14\.0\.2 <15'$/m)

  const versions = new Set()
  for (const match of lock.matchAll(/^ {2}glob@(\d+\.\d+\.\d+)(?:\(|:)/gm)) versions.add(match[1])
  for (const match of lock.matchAll(/^ {6}glob: (\d+\.\d+\.\d+)$/gm)) versions.add(match[1])
  assert.ok(versions.size > 0, 'expected glob to stay installed')

  const patched = []
  for (const version of versions) {
    assertNotVulnerable(version, 'lockfile')
    if (compare(parseVersion(version), FLOOR) >= 0) patched.push(version)
  }
  assert.ok(patched.length > 0, `expected a glob >= 14.0.2, found ${[...versions].join(', ')}`)
})

test('an unreferenced glob left in the pnpm store is not an active dependency', () => {
  const { root, store } = makeStore()
  try {
    mkdirSync(path.join(store, 'glob@11.1.0'), { recursive: true })
    writeGlobPackage(store, '13.0.6')
    writeGlobPackage(store, '14.0.4')
    writeGlobPackage(store, '7.2.3')
    linkGlob(store, 'workbox-build@7.4.1', '14.0.4')
    linkGlob(store, 'rimraf@3.0.2', '7.2.3')

    const versions = reachableGlobManifests(store).map((manifest) => JSON.parse(readFileSync(manifest, 'utf8')).version)
    assert.deepEqual(new Set(versions), new Set(['14.0.4', '7.2.3']))
    assert.equal(checkInstalledGlobs(store).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a glob the dependency graph still links is still checked', () => {
  const { root, store } = makeStore()
  try {
    writeGlobPackage(store, '11.1.0')
    writeGlobPackage(store, '14.0.4')
    linkGlob(store, '@sentry+bundler-plugin-core@5.3.0', '11.1.0')
    assert.throws(() => checkInstalledGlobs(store), /GHSA-3g3m-2fjr-6pw4/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('installed glob copies are patched when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const patched = checkInstalledGlobs(store)
  assert.ok(patched.length > 0, 'node_modules has no glob >= 14.0.2')

  const requireGlob = createRequire(patched[0])
  const glob = requireGlob(path.dirname(patched[0]))
  assert.equal(typeof glob.sync, 'function')
  assert.equal(typeof glob.globSync, 'function')
  assert.equal(typeof glob.glob, 'function')

  const dir = mkdtempSync(path.join(tmpdir(), 'mushi-glob-'))
  try {
    writeFileSync(path.join(dir, 'a.txt'), 'x')
    assert.deepEqual(glob.globSync('*.txt', { cwd: dir }), ['a.txt'])
    assert.deepEqual(glob.sync('*.txt', { cwd: dir }), ['a.txt'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
