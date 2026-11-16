/**
 * GHSA-g3hv-75wg-m249 (CVE-2026-118764) is fixed in minimatch 11.0.1.
 * It affects minimatch >= 7.0.0 and < 11.0.1. 3.x and 5.x are outside
 * that range; glob 7 also reads minimatch's v3 set entries, so those
 * copies stay. glob 11 and 13 walk minimatch's pre-11 set, so they are
 * overridden to glob 14, which depends on minimatch 11.
 *
 * The versions below are read from pnpm-lock.yaml. When node_modules is
 * present, the same versions are loaded from that lockfile's pnpm store
 * path, not from a hoisted name that can still point at an old copy.
 *
 * Run with `pnpm test:scripts`.
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

function assertMinimatchPatched(version, where) {
  const parsed = parseVersion(version)
  assert.ok(parsed, `${where}: ${version} is not a version`)
  // 3.x and 5.x are not in GHSA-g3hv-75wg-m249 (>= 7.0.0).
  if (parsed[0] < 7) return
  assert.ok(compare(parsed, FLOOR) >= 0, `${where}: minimatch@${version} is below 11.0.1`)
  assert.ok(compare(parsed, CEILING) < 0, `${where}: minimatch@${version} is outside 11.x`)
}

function snapshotBlocks(lock) {
  const start = lock.indexOf('\nsnapshots:\n')
  assert.ok(start >= 0, 'pnpm-lock.yaml has no snapshots')
  const body = lock.slice(start + '\nsnapshots:\n'.length)
  const blocks = new Map()
  let name = null
  let lines = []
  const flush = () => {
    if (name) blocks.set(name, lines.join('\n'))
  }
  for (const line of body.split('\n')) {
    if (line.startsWith('  ') && !line.startsWith('   ') && line.endsWith(':')) {
      flush()
      name = line.slice(2, -1)
      lines = []
      continue
    }
    if (name) lines.push(line)
  }
  flush()
  return blocks
}

test('minimatch 10 and glob 11/13 overrides are bounded', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const overrides = pkg.pnpm?.overrides ?? {}
  assert.equal(overrides['minimatch@10'], '>=11.0.1 <12')
  assert.equal(overrides['glob@11'], '>=14.0.4 <15')
  assert.equal(overrides['glob@13'], '>=14.0.4 <15')
  for (const range of [overrides['minimatch@10'], overrides['glob@11'], overrides['glob@13']]) {
    assert.equal(isBounded(range), true)
  }
})

test('pnpm-lock.yaml resolves no vulnerable minimatch and no pre-14 glob 11/13', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /^ {2}minimatch@10: '>=11\.0\.1 <12'$/m)
  assert.match(lock, /^ {2}glob@11: '>=14\.0\.4 <15'$/m)
  assert.match(lock, /^ {2}glob@13: '>=14\.0\.4 <15'$/m)

  const resolved = [...lock.matchAll(/^ {2}minimatch@(\d+\.\d+\.\d+):/gm)].map((m) => m[1])
  assert.ok(resolved.length > 0, 'expected minimatch to stay installed')
  assert.ok(resolved.some((version) => compare(parseVersion(version), FLOOR) >= 0), 'no patched minimatch in the lockfile')
  for (const version of resolved) assertMinimatchPatched(version, 'lockfile package')

  const blocks = snapshotBlocks(lock)
  let patchedEdges = 0
  for (const [name, body] of blocks) {
    const edge = body.match(/\n {6}minimatch: (\d+\.\d+\.\d+)\n/)
    if (!edge) continue
    assertMinimatchPatched(edge[1], `${name} -> minimatch`)
    if (parseVersion(edge[1])[0] >= 7) patchedEdges += 1
  }
  assert.ok(patchedEdges > 0, 'no snapshot depends on patched minimatch')

  const globPackages = [...blocks.keys()].filter((name) => name.startsWith('glob@'))
  assert.ok(globPackages.length > 0, 'expected glob to stay installed')
  for (const name of globPackages) {
    const version = name.slice('glob@'.length).split('(')[0]
    const parsed = parseVersion(version)
    assert.ok(parsed, name)
    if (parsed[0] === 11 || parsed[0] === 13) {
      assert.fail(`${name} is still installed; glob 14 is the release that uses minimatch 11`)
    }
    if (parsed[0] >= 14) {
      assert.ok(compare(parsed, GLOB_FLOOR) >= 0, `${name} is below glob 14.0.4`)
      assert.ok(compare(parsed, GLOB_CEILING) < 0, `${name} is outside glob 14.x`)
      const edge = blocks.get(name).match(/\n {6}minimatch: (\d+\.\d+\.\d+)\n/)
      assert.ok(edge, `${name} does not depend on minimatch`)
      assertMinimatchPatched(edge[1], name)
    }
  }
  assert.ok(globPackages.some((name) => parseVersion(name.slice('glob@'.length))[0] === 14), 'glob 14 was not installed')
})

function lockfilePackageIds(lock) {
  const ids = new Set()
  for (const match of lock.matchAll(/^ {2}((?:@[^@/]+\/)?[^@\s]+)@(\d+\.\d+\.\d+)(?:\(|:)/gm)) {
    ids.add(`${match[1]}@${match[2]}`)
  }
  return ids
}

function storePackageId(dirName) {
  const match = /^(.*?)@(\d+\.\d+\.\d+)/.exec(dirName)
  if (!match) return null
  // pnpm encodes a scope slash as "+" in the virtual store directory.
  return `${match[1].replaceAll('+', '/')}@${match[2]}`
}

function pnpmDirName(snapshotKey) {
  return snapshotKey.replaceAll('/', '+').replaceAll('(', '_').replaceAll(')', '')
}

test('installed copies linked from the lockfile are the patched versions', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const active = lockfilePackageIds(lock)
  const blocks = snapshotBlocks(lock)
  const blocksByDir = new Map([...blocks].map(([key, body]) => [pnpmDirName(key), body]))

  let patchedDir = null
  for (const id of active) {
    if (!id.startsWith('minimatch@')) continue
    const version = id.slice('minimatch@'.length)
    assertMinimatchPatched(version, 'lockfile package')
    const manifestPath = path.join(store, id, 'node_modules', 'minimatch', 'package.json')
    assert.ok(existsSync(manifestPath), `${id} is in the lockfile but not installed`)
    const installed = JSON.parse(readFileSync(manifestPath, 'utf8')).version
    assert.equal(installed, version)
    if (parseVersion(installed)[0] >= 7) patchedDir = path.dirname(manifestPath)
  }
  assert.ok(patchedDir, 'patched minimatch is not installed')

  // Load the lockfile's copy. A hoisted require() can still see an older one.
  const { minimatch, Minimatch } = createRequire(path.join(patchedDir, 'package.json'))('minimatch')
  assert.equal(minimatch('src/a.js', 'src/*.js'), true)
  assert.equal(minimatch('src/a.ts', 'src/*.js'), false)
  assert.equal(new Minimatch('src/*.js', { dot: true }).match('src/a.js'), true)

  let glob14 = null
  let linked = 0
  for (const dir of readdirSync(store)) {
    const parentId = storePackageId(dir)
    if (!parentId || !active.has(parentId)) continue
    const nodeModules = path.join(store, dir, 'node_modules')
    for (const child of ['minimatch', 'glob']) {
      // The package's own directory is not a dependency link.
      if (parentId.startsWith(`${child}@`)) continue
      const link = path.join(nodeModules, child)
      if (!existsSync(link)) continue
      const manifest = path.join(link, 'package.json')
      if (!existsSync(manifest)) continue
      const installed = JSON.parse(readFileSync(manifest, 'utf8')).version
      if (child === 'minimatch') {
        const body = blocksByDir.get(dir)
        assert.ok(body, `${dir} links minimatch but has no lockfile snapshot`)
        const edge = body.match(/\n {6}minimatch: (\d+\.\d+\.\d+)\n/)
        assert.ok(edge, `${dir} links minimatch but the lockfile snapshot does not`)
        assert.equal(installed, edge[1], `${dir} links minimatch@${installed}, lockfile says ${edge[1]}`)
        assertMinimatchPatched(installed, dir)
        linked += 1
      } else {
        const parsed = parseVersion(installed)
        assert.ok(parsed[0] !== 11 && parsed[0] !== 13, `${dir} still links glob@${installed}`)
        if (parsed[0] >= 14) glob14 = link
      }
    }
  }
  assert.ok(linked > 0, 'no active package links minimatch')
  assert.ok(glob14, 'no active package links glob 14')

  const { globSync } = createRequire(path.join(glob14, 'package.json'))('glob')
  const dir = mkdtempSync(path.join(tmpdir(), 'minimatch-fix-'))
  try {
    writeFileSync(path.join(dir, 'keep.txt'), 'ok')
    writeFileSync(path.join(dir, 'skip.md'), 'no')
    assert.deepEqual(globSync('*.txt', { cwd: dir }), ['keep.txt'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
