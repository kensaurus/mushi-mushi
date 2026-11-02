/**
 * GHSA-6pq8-jhm2-2vcw (CVE-2026-110816) is fixed in qs 6.16.1.
 * qs is not a direct dependency: express and body-parser pull it in, and
 * those releases still allow 6.16.0. The root pnpm.overrides entry forces
 * a patched 6.x. This checks the version pnpm resolved into pnpm-lock.yaml
 * (and node_modules, when installed).
 *
 * Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [6, 16, 1]
const CEILING = [7, 0, 0]

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

function assertPatched(version, where) {
  const parsed = parseVersion(version)
  assert.ok(parsed, `${where}: ${version} is not a version`)
  assert.ok(compare(parsed, FLOOR) >= 0, `${where}: ${version} is below 6.16.1`)
  assert.ok(compare(parsed, CEILING) < 0, `${where}: ${version} is outside 6.x`)
}

test('the qs override is a bounded 6.16.1 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const range = pkg.pnpm?.overrides?.['qs@6']
  assert.equal(range, '>=6.16.1 <7')
  assert.equal(isBounded(range), true)
})

test('pnpm-lock.yaml resolves only patched qs', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}qs@6: '>=6\.16\.1 <7'$/m)
  const versions = new Set()
  for (const match of lock.matchAll(/^ {2}qs@(\d+\.\d+\.\d+)(?:\(|:)/gm)) {
    versions.add(match[1])
  }
  assert.ok(versions.size > 0, 'expected qs to stay installed')
  for (const version of versions) assertPatched(version, 'lockfile')
})

test('installed qs copies are patched when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const dirs = readdirSync(store).filter((name) => name.startsWith('qs@'))
  assert.ok(dirs.length > 0, 'pnpm store has no qs package')
  for (const dir of dirs) {
    const version = dir.slice('qs@'.length).split('(')[0].split('_')[0]
    assertPatched(version, 'node_modules/.pnpm')
    const manifest = path.join(store, dir, 'node_modules', 'qs', 'package.json')
    if (existsSync(manifest)) {
      const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
      assertPatched(installed, manifest)
    }
  }
})
