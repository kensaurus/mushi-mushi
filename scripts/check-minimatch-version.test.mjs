/**
 * FILE: scripts/check-minimatch-version.test.mjs
 * PURPOSE: Lock the GHSA-g3hv-75wg-m249 override to a patched minimatch 11
 *          and a glob that can actually run it.
 *
 * OVERVIEW:
 * - GHSA-g3hv-75wg-m249 (CVE-2026-118764) affects minimatch >=7.0.0 <11.0.1.
 *   The installed vulnerable copy is 10.2.5. 3.1.5 and 5.1.9 are outside
 *   that range; OSV reports no advisories for them, and glob@7 / filelist
 *   still call the v3/v5 function export.
 * - glob 11 and 13 compile with optimizationLevel 2 and walk Minimatch.set
 *   as RegExp parts. minimatch 11 replaced those parts with Matcher objects
 *   and removed makeRe(), so those glob majors move to 14.0.4, the oldest
 *   glob 14 that requires minimatch ^11.0.5. 14.0.4 (2026-11-06) and
 *   minimatch 11.0.5 (2026-11-05) are already past the 7-day release cooldown.
 *
 * DEPENDENCIES:
 * - node:test, node:fs, node:path
 * - scripts/check-dependency-overrides.mjs (isBounded)
 *
 * USAGE:
 * - Run with `pnpm test:scripts` or `node --test scripts/check-minimatch-version.test.mjs`
 *
 * NOTES:
 * - A version check is enough. This file does not build an amplification input.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [11, 0, 1]
const CEILING = [12, 0, 0]
const GLOB_FLOOR = [14, 0, 4]
const GLOB_CEILING = [15, 0, 0]

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

function inAdvisoryRange(version) {
  const parsed = parseVersion(version)
  assert.ok(parsed, `${version} is not a version`)
  return compare(parsed, [7, 0, 0]) >= 0 && compare(parsed, FLOOR) < 0
}

test('minimatch 10 and the glob majors that walk its regexps are bounded overrides', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const overrides = pkg.pnpm?.overrides ?? {}
  assert.equal(overrides['minimatch@10'], '>=11.0.1 <12')
  assert.equal(overrides['glob@11'], '>=14.0.4 <15')
  assert.equal(overrides['glob@13'], '>=14.0.4 <15')
  assert.equal(isBounded(overrides['minimatch@10']), true)
  assert.equal(isBounded(overrides['glob@11']), true)
  assert.equal(isBounded(overrides['glob@13']), true)
  assert.equal(overrides.minimatch, undefined)
})

test('pnpm-lock.yaml has no minimatch in the advisory range and no glob 11 or 13', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}minimatch@10: '>=11\.0\.1 <12'$/m)
  assert.match(lock, /^ {2}glob@11: '>=14\.0\.4 <15'$/m)
  assert.match(lock, /^ {2}glob@13: '>=14\.0\.4 <15'$/m)

  const minimatch = new Set()
  for (const match of lock.matchAll(/^ {2}minimatch@(\d+\.\d+\.\d+)(?:\(|:)/gm)) {
    minimatch.add(match[1])
  }
  assert.ok(minimatch.size > 0, 'expected minimatch to stay installed')
  for (const version of minimatch) {
    assert.equal(inAdvisoryRange(version), false, `${version} is still in >=7.0.0 <11.0.1`)
  }
  assert.ok(minimatch.has('3.1.5'), 'minimatch 3.1.5 is outside this advisory and stays')
  assert.ok(minimatch.has('5.1.9'), 'minimatch 5.1.9 is outside this advisory and stays')
  const patched = [...minimatch].filter((version) => compare(parseVersion(version), FLOOR) >= 0)
  assert.ok(patched.length > 0, 'expected a minimatch 11.x resolution')
  for (const version of patched) {
    assert.ok(compare(parseVersion(version), CEILING) < 0, `${version} is outside 11.x`)
  }

  const globs = new Set()
  for (const match of lock.matchAll(/^ {2}glob@(\d+\.\d+\.\d+)(?:\(|:)/gm)) globs.add(match[1])
  for (const match of lock.matchAll(/^ {6}glob: (\d+\.\d+\.\d+)$/gm)) globs.add(match[1])
  assert.ok(globs.size > 0, 'expected glob to stay installed')
  for (const version of globs) {
    const parsed = parseVersion(version)
    const major = parsed[0]
    if (major === 7) continue
    if (major === 11 || major === 13) {
      assert.fail(`glob ${version} still walks minimatch 10 regexp parts`)
    }
    if (major >= 14) {
      assert.ok(compare(parsed, GLOB_FLOOR) >= 0, `${version} is below glob 14.0.4`)
      assert.ok(compare(parsed, GLOB_CEILING) < 0, `${version} is outside glob 14.x`)
    }
  }
})

test('installed minimatch 11 and glob 14 match a normal pattern when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const names = readdirSync(store)
  // Orphaned virtual-store folders can survive an in-place install. The
  // lockfile test is what forbids resolving them; here, require the patched
  // copies to be present and to match a normal pattern.
  const minimatchDir = names.find((name) => name.startsWith('minimatch@11.'))
  const globDir = names.find((name) => name.startsWith('glob@14.'))
  assert.ok(minimatchDir, 'pnpm store has no minimatch 11')
  assert.ok(globDir, 'pnpm store has no glob 14')

  const minimatchPkg = path.join(store, minimatchDir, 'node_modules', 'minimatch', 'package.json')
  const globPkg = path.join(store, globDir, 'node_modules', 'glob', 'package.json')
  assert.equal(inAdvisoryRange(JSON.parse(readFileSync(minimatchPkg, 'utf8')).version), false)
  const globVersion = parseVersion(JSON.parse(readFileSync(globPkg, 'utf8')).version)
  assert.ok(compare(globVersion, GLOB_FLOOR) >= 0)

  const dir = mkdtempSync(path.join(tmpdir(), 'mushi-minimatch-'))
  try {
    writeFileSync(path.join(dir, 'note.txt'), 'ok\n')
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import { createRequire } from 'node:module'
          import path from 'node:path'
          const require = createRequire(${JSON.stringify(minimatchPkg)})
          const { minimatch, Minimatch } = require(${JSON.stringify(path.join(store, minimatchDir, 'node_modules', 'minimatch'))})
          if (minimatch('src/a.js', 'src/*.js') !== true) process.exit(2)
          if (new Minimatch('src/*.js', { dot: true }).match('src/a.js') !== true) process.exit(3)
          const { globSync, sync } = require(${JSON.stringify(path.join(store, globDir, 'node_modules', 'glob'))})
          const found = globSync('*.txt', { cwd: ${JSON.stringify(dir)} })
          if (!found.includes('note.txt')) process.exit(4)
          if (typeof sync !== 'function' || !sync('*.txt', { cwd: ${JSON.stringify(dir)} }).includes('note.txt')) process.exit(5)
        `,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(
      probe.status,
      0,
      probe.stderr || probe.stdout || probe.error?.message || 'minimatch/glob probe failed',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
