/**
 * node-forge <=1.4.2 is affected by GHSA-6cv4-p8m7-4r25 (forge.http ReDoS),
 * GHSA-j8rw-jp99-435v (TLS client crash without a session),
 * GHSA-w4xr-hqv8-ch44 (TLS client crash on ServerHello compression) and
 * GHSA-6889-vf6x-f3g5 (Ed25519 small-order keys). 1.4.3 is the patched
 * release. It is transitive (apps/docs → @expo/cli). The root
 * pnpm.overrides entry forces that release. 1.4.3 shipped 2026-11-04 and is
 * past the 7-day cooldown, so pnpm-workspace.yaml does not exclude it.
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
const FIX = '1.4.3'
const ADVISORIES = [
  'GHSA-6cv4-p8m7-4r25',
  'GHSA-j8rw-jp99-435v',
  'GHSA-w4xr-hqv8-ch44',
  'GHSA-6889-vf6x-f3g5',
]

test('the node-forge override is the patched release', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const range = pkg.pnpm?.overrides?.['node-forge']
  assert.equal(range, FIX)
  assert.equal(isBounded(range), true)
})

test('pnpm-lock.yaml resolves only node-forge 1.4.3', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}node-forge: 1\.4\.3$/m)
  const versions = new Set()
  for (const match of lock.matchAll(/^ {2}node-forge@(\d+\.\d+\.\d+)(?:\(|:)/gm)) {
    versions.add(match[1])
  }
  assert.deepEqual([...versions], [FIX])
})

test('the patched advisories are not ignored', () => {
  const osv = readFileSync(path.join(ROOT, 'osv-scanner.toml'), 'utf8')
  for (const id of ADVISORIES) {
    assert.equal(osv.includes(id), false, `${id} is still ignored by osv-scanner`)
  }
})

test('installed node-forge copies are patched when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const dirs = readdirSync(store).filter((name) => name.startsWith('node-forge@'))
  assert.ok(dirs.length > 0, 'pnpm store has no node-forge package')
  for (const dir of dirs) {
    const version = dir.slice('node-forge@'.length).split('(')[0].split('_')[0]
    assert.equal(version, FIX, `node_modules/.pnpm/${dir}`)
    const manifest = path.join(store, dir, 'node_modules', 'node-forge', 'package.json')
    if (existsSync(manifest)) {
      const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
      assert.equal(installed, FIX, manifest)
    }
  }
})
