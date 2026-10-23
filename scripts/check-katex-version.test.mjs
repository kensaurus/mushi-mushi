/**
 * GHSA-238p-pmpm-9mq7 (CVE-2026-103923) is fixed in katex 0.18.2.
 * katex is not a direct dependency: nextra, rehype-katex and mermaid pull
 * it in, and none of those releases require 0.18.2 yet. The root
 * pnpm.overrides entry forces a patched 0.18.x. This checks the version
 * pnpm resolved into pnpm-lock.yaml (and node_modules, when installed).
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
const FLOOR = [0, 18, 2]
const CEILING = [0, 19, 0]

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
  assert.ok(compare(parsed, FLOOR) >= 0, `${where}: ${version} is below 0.18.2`)
  assert.ok(compare(parsed, CEILING) < 0, `${where}: ${version} is outside 0.18.x`)
}

test('the katex override is a bounded 0.18.2 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const range = pkg.pnpm?.overrides?.katex
  assert.equal(range, '>=0.18.2 <0.19')
  assert.equal(isBounded(range), true)
})

test('pnpm-lock.yaml resolves only patched katex', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const versions = new Set()
  for (const match of lock.matchAll(/^  katex@(\d+\.\d+\.\d+)(?:\(|:)/gm)) {
    versions.add(match[1])
  }
  assert.ok(versions.size > 0, 'expected katex to stay installed')
  for (const version of versions) assertPatched(version, 'lockfile')
})

test('installed katex copies are patched when node_modules is present', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const dirs = readdirSync(store).filter((name) => name.startsWith('katex@'))
  assert.ok(dirs.length > 0, 'pnpm store has no katex package')
  for (const dir of dirs) {
    const version = dir.slice('katex@'.length).split('(')[0].split('_')[0]
    assertPatched(version, 'node_modules/.pnpm')
    const manifest = path.join(store, dir, 'node_modules', 'katex', 'package.json')
    if (existsSync(manifest)) {
      const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
      assertPatched(installed, manifest)
    }
  }
})
