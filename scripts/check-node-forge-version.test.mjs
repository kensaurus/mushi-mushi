/**
 * node-forge <=1.4.2 is affected by GHSA-6cv4-p8m7-4r25 (forge.http ReDoS),
 * GHSA-j8rw-jp99-435v (TLS client crash without a session),
 * GHSA-w4xr-hqv8-ch44 (TLS client crash on ServerHello compression) and
 * GHSA-6889-vf6x-f3g5 (Ed25519 small-order keys). 1.4.3 is the patched
 * release. It is transitive (apps/docs → @expo/cli and
 * @expo/code-signing-certificates). The root pnpm.overrides entry forces
 * that release. 1.4.3 shipped 2026-11-04 and is past the 7-day cooldown,
 * so pnpm-workspace.yaml does not exclude it.
 *
 * Installed copies are the node-forge package an installed consumer
 * resolves. pnpm can retain an obsolete node-forge directory under
 * node_modules/.pnpm after an upgrade, and a filtered install that omits
 * apps/docs has no consumer directory. Neither is an active dependency.
 *
 * Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/**
 * Snapshot ids under pnpm-lock.yaml `snapshots:` that depend on node-forge.
 * The packages index, importers, and a transitive-peer list are not consumers.
 */
export function nodeForgeConsumers(lock) {
  const consumers = []
  const seen = new Set()
  let inSnapshots = false
  let current = null
  let inDeps = false
  for (const raw of lock.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!inSnapshots) {
      if (line === 'snapshots:') inSnapshots = true
      continue
    }
    if (line.length > 0 && !line.startsWith(' ')) break
    if (line.startsWith('  ') && !line.startsWith('   ')) {
      const header = line.match(/^  (?:'([^']+)'|"([^"]+)"|([^:'" ]+)):/)
      current = header ? (header[1] ?? header[2] ?? header[3]) : null
      inDeps = false
      continue
    }
    if (!current) continue
    if (line === '    dependencies:' || line === '    optionalDependencies:') {
      inDeps = true
      continue
    }
    if (inDeps && line.startsWith('    ') && !line.startsWith('     ')) inDeps = false
    if (inDeps && /^      node-forge:/.test(line) && !seen.has(current)) {
      seen.add(current)
      consumers.push(current)
    }
  }
  return consumers
}

/** `@expo/cli@55.0.24(peers)` → the virtual-store stem `@expo+cli@55.0.24`. */
function storePrefix(snapshotId) {
  return snapshotId.split('(')[0].replaceAll('/', '+')
}

function matchingStoreDirs(names, snapshotId) {
  const prefix = storePrefix(snapshotId)
  return names.filter(
    (name) => name === prefix || name.startsWith(`${prefix}_`) || name.startsWith(`${prefix}(`),
  )
}

/**
 * node-forge versions resolved by consumers whose virtual-store directory
 * is installed. Absent consumers are skipped. Directories named `node-forge@*`
 * are not consulted: pnpm retains those after an upgrade even when nothing
 * links them.
 */
export function resolvedNodeForgeVersions(store, consumers) {
  if (!existsSync(store)) return []
  const names = readdirSync(store)
  const copies = []
  for (const consumer of consumers) {
    for (const dir of matchingStoreDirs(names, consumer)) {
      const where = path.join(store, dir, 'node_modules', 'node-forge', 'package.json')
      if (!existsSync(where)) continue
      copies.push({ version: JSON.parse(readFileSync(where, 'utf8')).version, where })
    }
  }
  return copies
}

function withStore(setup) {
  const root = mkdtempSync(path.join(tmpdir(), 'node-forge-'))
  try {
    return setup(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeResolved(store, dir, version) {
  const dest = path.join(store, dir, 'node_modules', 'node-forge')
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: 'node-forge', version }))
}

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

test('the lockfile consumers of node-forge are the Expo packages', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const names = nodeForgeConsumers(lock).map((id) => storePrefix(id).replace(/@[^@]+$/, ''))
  assert.deepEqual(names.sort(), ['@expo+cli', '@expo+code-signing-certificates'])
})

test('only snapshot dependencies count as node-forge consumers', () => {
  const lock = `
overrides:
  node-forge: 1.4.2

importers:
  apps/docs:
    dependencies:
      node-forge: 1.4.2

packages:
  node-forge@1.4.2:
    resolution: {integrity: sha512-old}

snapshots:

  node-forge@1.4.2: {}

  left-pad@1.0.0:
    dependencies:
      something: 1.0.0
    transitivePeerDependencies:
      - node-forge

  '@expo/cli@55.0.24(@expo/dom-webview@55.0.5)':
    dependencies:
      node-forge: 1.4.3

  '@expo/code-signing-certificates@0.0.6':
    optionalDependencies:
      node-forge: 1.4.3
    dependencies:
      node-forge: 1.4.3
`
  assert.deepEqual(nodeForgeConsumers(lock), [
    '@expo/cli@55.0.24(@expo/dom-webview@55.0.5)',
    '@expo/code-signing-certificates@0.0.6',
  ])
})

test('a retained obsolete node-forge directory is not an active dependency', () => {
  const versions = withStore((store) => {
    writeResolved(store, 'node-forge@1.4.2', '1.4.2')
    writeResolved(store, '@expo+cli@55.0.240_other', '1.4.2')
    writeResolved(
      store,
      '@expo+cli@55.0.24_@expo+dom-webview@55.0.5_peers_35b644f3d50cf941cfcd8d52d93e1710',
      FIX,
    )
    return resolvedNodeForgeVersions(store, ['@expo/cli@55.0.24(@expo/dom-webview@55.0.5)']).map(
      (copy) => copy.version,
    )
  })
  assert.deepEqual(versions, [FIX])
})

test('a filtered install with no node-forge consumer does not require a node-forge directory', () => {
  const absent = withStore((store) => {
    writeResolved(store, 'left-pad@1.0.0', '1.0.0')
    return resolvedNodeForgeVersions(store, ['@expo/cli@55.0.24(@expo/dom-webview@55.0.5)'])
  })
  assert.deepEqual(absent, [])

  const leftoverOnly = withStore((store) => {
    writeResolved(store, 'node-forge@1.4.2', '1.4.2')
    return resolvedNodeForgeVersions(store, [
      '@expo/cli@55.0.24(@expo/dom-webview@55.0.5)',
      '@expo/code-signing-certificates@0.0.6',
    ])
  })
  assert.deepEqual(leftoverOnly, [])
})

test('an installed consumer that resolved node-forge 1.4.2 is reported', () => {
  const copies = withStore((store) => {
    writeResolved(store, 'node-forge@1.4.3', FIX)
    writeResolved(store, '@expo+code-signing-certificates@0.0.6', '1.4.2')
    return resolvedNodeForgeVersions(store, ['@expo/code-signing-certificates@0.0.6'])
  })
  assert.deepEqual(
    copies.map((copy) => copy.version),
    ['1.4.2'],
  )
})

test('installed node-forge copies resolved by consumers are patched', () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const consumers = nodeForgeConsumers(lock)
  assert.ok(consumers.length > 0, 'lockfile has no node-forge consumer')
  const copies = resolvedNodeForgeVersions(store, consumers)
  for (const copy of copies) assert.equal(copy.version, FIX, copy.where)
  const short = path.join(
    store,
    '@expo+code-signing-certificates@0.0.6',
    'node_modules',
    'node-forge',
    'package.json',
  )
  if (existsSync(short)) {
    assert.ok(
      copies.some((copy) => copy.where === short),
      'installed @expo/code-signing-certificates did not resolve node-forge',
    )
  }
})
