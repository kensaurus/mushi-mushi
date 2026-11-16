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
 *
 * DEPENDENCIES: node:test, node:fs, scripts/check-dependency-overrides.mjs
 * USAGE: node --test scripts/check-minimatch-version.test.mjs
 *        (also listed in the root `test:scripts` script)
 *
 * NOTES: The floor is 11.0.8, above the report's 11.0.1, because 11.0.1
 *        is still inside the later advisories. A test that the resolved
 *        version is that release is enough; this file does not reproduce
 *        the advisories.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [11, 0, 8]
const CEILING = [12, 0, 0]
const OVERRIDE = '>=11.0.8 <12'

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

test('the minimatch 10 override is a bounded 11.0.8 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const range = pkg.pnpm?.overrides?.['minimatch@10']
  assert.equal(range, OVERRIDE)
  assert.equal(isBounded(range), true)
})

test('11.0.8 is exempt from the release cooldown until it ages out', () => {
  const workspace = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(workspace, /^ {2}- 'minimatch@11\.0\.8'$/m)
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

test('installed minimatch 10+ copies are patched and still match a literal glob', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const dirs = readdirSync(store).filter((name) => name.startsWith('minimatch@'))
  assert.ok(dirs.length > 0, 'pnpm store has no minimatch package')
  const require = createRequire(import.meta.url)
  let checkedModern = false
  for (const dir of dirs) {
    const version = dir.slice('minimatch@'.length).split('(')[0].split('_')[0]
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
