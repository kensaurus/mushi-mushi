/**
 * GHSA-5r4p-p66f-jhc7 (serveStatic decodes the path twice) is fixed in
 * hono 4.13.11. The workspace must install that release or newer.
 * Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** First release that includes the fix. */
const FIX = [4, 13, 11]

function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  assert.ok(match, `not a version: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeast(version, floor) {
  const got = parts(version)
  for (let i = 0; i < 3; i++) {
    if (got[i] !== floor[i]) return got[i] > floor[i]
  }
  return true
}

test('the direct dependency and the applied override floor are 4.13.11', () => {
  const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const server = JSON.parse(readFileSync(path.join(ROOT, 'packages/server/package.json'), 'utf8'))
  assert.equal(server.devDependencies.hono, '^4.13.11')
  assert.equal(root.pnpm.overrides.hono, '>=4.13.11 <5')
})

test('pnpm-lock.yaml resolves hono at or above 4.13.11', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}hono: '>=4\.13\.11 <5'$/m)
  const resolved = [...lock.matchAll(/^ {2}hono@(\d+\.\d+\.\d+):/gm)].map((m) => m[1])
  assert.ok(resolved.length > 0, 'no hono package in the lockfile')
  for (const version of resolved) {
    assert.ok(atLeast(version, FIX), `hono@${version} is below 4.13.11`)
  }
})

test('deno.lock pins hono at or above 4.13.11', () => {
  for (const rel of ['deno.lock', 'packages/server/deno.lock']) {
    const lock = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'))
    const specs = Object.entries(lock.specifiers ?? {}).filter(([spec]) => spec.includes('hono'))
    assert.ok(specs.length > 0, `${rel} has no hono specifier`)
    for (const [spec, version] of specs) {
      assert.ok(atLeast(version, FIX), `${rel} ${spec} -> ${version}`)
    }
    for (const key of [...Object.keys(lock.jsr ?? {}), ...Object.keys(lock.npm ?? {})]) {
      if (!key.includes('hono')) continue
      const version = key.slice(key.lastIndexOf('@') + 1)
      assert.ok(atLeast(version, FIX), `${rel} ${key}`)
    }
  }
})

test('the installed hono package is the fixed release', () => {
  // Resolved through packages/server, which depends on hono. Knip treats a
  // binding named `require` as a root dependency, so this local has another name.
  const requireFromServer = createRequire(path.join(ROOT, 'packages/server/package.json'))
  let dir = path.dirname(requireFromServer.resolve('hono'))
  let version
  for (let i = 0; i < 6; i++) {
    const manifest = path.join(dir, 'package.json')
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (pkg.name === 'hono') {
        version = pkg.version
        break
      }
    }
    dir = path.dirname(dir)
  }
  assert.ok(version, 'installed hono package.json not found from @mushi-mushi/server')
  assert.ok(atLeast(version, FIX), version)
})
