/**
 * GHSA-3g3m-2fjr-6pw4 (CVE-2026-118773) is fixed in glob 14.0.2.
 * glob is not a direct dependency. @expo/*, @sentry/bundler-plugin-core
 * and workbox-build still allow 13.0.6 and 11.1.0. Those majors are
 * overridden onto 14.x. glob 7 stays: the advisory starts at 9.0.0, and
 * 7.x is a different API. This checks the version pnpm resolved into
 * pnpm-lock.yaml (and node_modules, when installed) and that 14.x still
 * exports the calls those packages make.
 *
 * Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [14, 0, 2]
const CEILING = [15, 0, 0]
const ADVISORY_START = [9, 0, 0]
const OVERRIDE = '>=14.0.2 <15'

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

/** True for 9.0.0 through 14.0.1, the range GHSA-3g3m-2fjr-6pw4 names. */
function isVulnerable(version) {
  const parsed = parseVersion(version)
  if (!parsed) return false
  return compare(parsed, ADVISORY_START) >= 0 && compare(parsed, FLOOR) < 0
}

function assertPatched(version, where) {
  const parsed = parseVersion(version)
  assert.ok(parsed, `${where}: ${version} is not a version`)
  assert.ok(!isVulnerable(version), `${where}: ${version} is in the GHSA-3g3m-2fjr-6pw4 range`)
  if (compare(parsed, ADVISORY_START) >= 0) {
    assert.ok(compare(parsed, FLOOR) >= 0, `${where}: ${version} is below 14.0.2`)
    assert.ok(compare(parsed, CEILING) < 0, `${where}: ${version} is outside 14.x`)
  }
}

function globVersions(lock) {
  const versions = new Set()
  for (const match of lock.matchAll(/^ {2}glob@(\d+\.\d+\.\d+)(?:\(|:)/gm)) {
    versions.add(match[1])
  }
  for (const match of lock.matchAll(/^ {6}glob: (\d+\.\d+\.\d+)$/gm)) {
    versions.add(match[1])
  }
  return versions
}

test('the glob 11 and 13 overrides are a bounded 14.0.2 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  for (const key of ['glob@11', 'glob@13']) {
    const range = pkg.pnpm?.overrides?.[key]
    assert.equal(range, OVERRIDE, key)
    assert.equal(isBounded(range), true, key)
  }
})

test('pnpm-lock.yaml resolves glob 11 and 13 onto a patched 14.x', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}glob@11: '>=14\.0\.2 <15'$/m)
  assert.match(lock, /^ {2}glob@13: '>=14\.0\.2 <15'$/m)
  const versions = globVersions(lock)
  assert.ok(versions.size > 0, 'expected glob to stay installed')
  const patched = [...versions].filter((version) => {
    const parsed = parseVersion(version)
    return parsed && compare(parsed, FLOOR) >= 0 && compare(parsed, CEILING) < 0
  })
  assert.ok(patched.length > 0, `no glob >=14.0.2 <15 in the lockfile (${[...versions].join(', ')})`)
  for (const version of versions) assertPatched(version, 'lockfile')
  assert.ok(versions.has('7.2.3'), 'glob 7.2.3 should stay; the advisory starts at 9.0.0')
})

test('installed glob copies are patched when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const dirs = readdirSync(store).filter((name) => name.startsWith('glob@'))
  assert.ok(dirs.length > 0, 'pnpm store has no glob package')
  const versions = []
  for (const dir of dirs) {
    const version = dir.slice('glob@'.length).split('(')[0].split('_')[0]
    versions.push(version)
    assertPatched(version, 'node_modules/.pnpm')
    const manifest = path.join(store, dir, 'node_modules', 'glob', 'package.json')
    if (existsSync(manifest)) {
      const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
      assertPatched(installed, manifest)
    }
  }
  assert.ok(
    versions.some((version) => {
      const parsed = parseVersion(version)
      return parsed && compare(parsed, FLOOR) >= 0 && compare(parsed, CEILING) < 0
    }),
    `node_modules has no glob >=14.0.2 <15 (${versions.join(', ')})`,
  )
})

test('glob 14 still exports the calls expo, sentry and workbox make', async () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const dir = readdirSync(store).find((name) => /^glob@14\.\d+\.\d+/.test(name))
  assert.ok(dir, 'glob 14 is not installed')
  const entry = path.join(store, dir, 'node_modules', 'glob', 'package.json')
  const glob = createRequire(entry)('glob')
  assert.equal(typeof glob.glob, 'function')
  assert.equal(typeof glob.globSync, 'function')
  assert.equal(typeof glob.sync, 'function')
  assert.equal(typeof glob.globStream, 'function')

  const workspace = mkdtempSync(path.join(tmpdir(), 'glob-api-'))
  try {
    writeFileSync(path.join(workspace, 'a.txt'), 'x')
    assert.deepEqual(glob.globSync('*.txt', { cwd: workspace }), ['a.txt'])
    assert.deepEqual(glob.sync('*.txt', { cwd: workspace, absolute: false }), ['a.txt'])
    const streamed = await new Promise((resolve, reject) => {
      const files = []
      glob
        .globStream('*.txt', { cwd: workspace })
        .on('data', (file) => files.push(String(file)))
        .on('error', reject)
        .on('end', () => resolve(files))
    })
    assert.deepEqual(streamed, ['a.txt'])
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
