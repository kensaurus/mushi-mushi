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
 * - When node_modules is installed, checks .pnpm copies and globSync().
 *
 * NOTES:
 * - A 14.x newer than 14.0.2 is still a fix. The ceiling stays below 15.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('installed glob copies are patched when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const dirs = readdirSync(store).filter((name) => name.startsWith('glob@'))
  assert.ok(dirs.length > 0, 'pnpm store has no glob package')
  const patched = []
  for (const dir of dirs) {
    const version = dir.slice('glob@'.length).split('(')[0].split('_')[0]
    assertNotVulnerable(version, 'node_modules/.pnpm')
    const manifest = path.join(store, dir, 'node_modules', 'glob', 'package.json')
    if (!existsSync(manifest)) continue
    const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
    assertNotVulnerable(installed, manifest)
    if (compare(parseVersion(installed), FLOOR) >= 0) patched.push(manifest)
  }
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
