/**
 * FILE: check-glob-version.test.mjs
 * PURPOSE: Keep GHSA-3g3m-2fjr-6pw4 (CVE-2026-118773) out of the install.
 *
 * OVERVIEW:
 * - glob 11.1.0 and 13.0.6 are transitive (Expo, Sentry bundler, workbox-build).
 * - The abort-signal fix exists only on 14.0.2 and newer; 7.x is a different
 *   API and is outside the advisory, so it must stay for rimraf 3.
 * - The root pnpm.overrides entries force 11 and 13 onto a patched 14.x.
 *
 * DEPENDENCIES:
 * - node:test, node:assert/strict, node:fs, node:module, node:os
 * - scripts/check-dependency-overrides.mjs (isBounded)
 *
 * USAGE:
 * - Run with `pnpm test:scripts` or `node --test scripts/check-glob-version.test.mjs`
 * - Reads package.json, pnpm-lock.yaml, and node_modules/.pnpm when installed
 *
 * TECHNICAL DETAILS:
 * - Floor 14.0.2, ceiling 15. Versions below 9 are allowed.
 * - A version in [9.0.0, 14.0.2) fails the lockfile check and, when
 *   another package still links it, the store check.
 *
 * NOTES:
 * - The store check follows links, then calls glob.sync and globSync.
 *   It does not reproduce the advisory. The patched version is the fix.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [14, 0, 2]
const CEILING = [15, 0, 0]
const ADVISORY = 'GHSA-3g3m-2fjr-6pw4'
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

/** 7.x stays. 9.0.0 through 14.0.1 is the advisory. 14.0.2+ within 14.x is the fix. */
function assertAllowed(version, where) {
  const parsed = parseVersion(version)
  assert.ok(parsed, `${where}: ${version} is not a version`)
  if (compare(parsed, [9, 0, 0]) < 0) return
  assert.ok(compare(parsed, FLOOR) >= 0, `${where}: glob@${version} is below 14.0.2`)
  assert.ok(compare(parsed, CEILING) < 0, `${where}: glob@${version} is outside 14.x`)
}

function globVersions(lock) {
  const versions = new Set()
  for (const match of lock.matchAll(/^ {2}glob@(\d+\.\d+\.\d+):/gm)) versions.add(match[1])
  for (const match of lock.matchAll(/^ {6}glob: (\d+\.\d+\.\d+)/gm)) versions.add(match[1])
  return versions
}

test('glob 11 and 13 overrides are a bounded 14.0.2 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  for (const key of ['glob@11', 'glob@13']) {
    assert.equal(pkg.pnpm?.overrides?.[key], RANGE)
    assert.equal(isBounded(pkg.pnpm.overrides[key]), true)
  }
  assert.equal(pkg.pnpm.overrides.glob, undefined)
})

test('pnpm-lock.yaml resolves glob 11 and 13 to a patched 14.x and keeps glob 7', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const workspace = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const osv = readFileSync(path.join(ROOT, 'osv-scanner.toml'), 'utf8')
  assert.equal(workspace.includes(ADVISORY), false, `${ADVISORY} is still ignored by pnpm`)
  assert.equal(osv.includes(ADVISORY), false, `${ADVISORY} is still ignored by osv-scanner`)
  assert.match(lock, /^ {2}glob@11: '>=14\.0\.2 <15'$/m)
  assert.match(lock, /^ {2}glob@13: '>=14\.0\.2 <15'$/m)

  const versions = globVersions(lock)
  assert.ok(versions.has('7.2.3'), 'glob 7.2.3 should stay installed for rimraf 3')
  let patched = false
  for (const version of versions) {
    assertAllowed(version, 'lockfile')
    const parsed = parseVersion(version)
    if (parsed && compare(parsed, FLOOR) >= 0) patched = true
  }
  assert.equal(patched, true, 'expected a patched glob 14.x in the lockfile')
})

/**
 * Glob packages another installed package actually links. pnpm can leave a
 * glob@11 or glob@13 directory behind after the override; that directory is
 * not on the dependency graph unless something points at it.
 */
function linkedGlobManifests(store) {
  const manifests = []
  const seen = new Set()
  let names
  try {
    names = readdirSync(store)
  } catch {
    return manifests
  }
  const candidates = names
    .filter((name) => !name.startsWith('glob@'))
    .map((name) =>
      name === 'node_modules'
        ? path.join(store, 'node_modules', 'glob')
        : path.join(store, name, 'node_modules', 'glob'),
    )
  candidates.push(path.join(store, '..', 'glob'))
  for (const globDir of candidates) {
    if (!existsSync(globDir)) continue
    let real
    try {
      real = realpathSync(globDir)
    } catch {
      continue
    }
    const manifest = path.join(real, 'package.json')
    if (!existsSync(manifest) || seen.has(manifest)) continue
    seen.add(manifest)
    manifests.push(manifest)
  }
  return manifests
}

test('installed glob copies are patched when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const manifests = linkedGlobManifests(store)
  assert.ok(manifests.length > 0, 'pnpm store has no linked glob package')
  let patched = null
  for (const manifest of manifests) {
    const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
    assertAllowed(installed, manifest)
    const parsed = parseVersion(installed)
    if (parsed && compare(parsed, FLOOR) >= 0) patched = manifest
  }
  assert.ok(patched, 'node_modules has no linked glob 14.x')

  const requireGlob = createRequire(patched)
  const glob = requireGlob(path.dirname(patched))
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
