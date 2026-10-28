/**
 * GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq are fixed in image-size 2.0.3.
 * Metro 0.83 and 0.84 declare image-size ^1.0.2, and getAssetData passes a
 * filename. 2.x sizes a buffer only, so the override is paired with a pnpm
 * patch that reads the file first. This checks the pin, the patch, and — when
 * node_modules is installed — Metro's own getAssetData on a real PNG plus the
 * zero-size ICNS and JXL payloads that used to loop forever.
 *
 * Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBounded } from './check-dependency-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLOOR = [2, 0, 3]
const CEILING = [3, 0, 0]
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const ADVISORIES = ['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq']

function parseVersion(spec) {
  const match = String(spec).match(/^(\d+)\.(\d+)\.(\d+)$/)
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
  assert.ok(parsed, `${where}: ${version} is not a release version`)
  assert.ok(compare(parsed, FLOOR) >= 0, `${where}: ${version} is below 2.0.3`)
  assert.ok(compare(parsed, CEILING) < 0, `${where}: ${version} is outside 2.x`)
}

/**
 * Metro snapshots whose dependency block lists image-size.
 * A patched snapshot is `metro@0.83.5(patch_hash=…)`.
 */
export function metroSnapshotsUsingImageSize(lock) {
  const snapshots = []
  let version = null
  let suffix = ''
  let inDependencies = false
  for (const line of lock.split('\n')) {
    const header = line.match(/^  metro@(\d+\.\d+\.\d+)(.*):$/)
    if (header) {
      version = header[1]
      suffix = header[2]
      inDependencies = false
      continue
    }
    if (version && /^  \S/.test(line)) {
      version = null
      inDependencies = false
      continue
    }
    if (!version) continue
    if (line === '    dependencies:') {
      inDependencies = true
      continue
    }
    if (inDependencies && /^    \S/.test(line)) inDependencies = false
    if (inDependencies && /^      image-size:/.test(line)) snapshots.push({ version, suffix })
  }
  return snapshots
}

/** pnpm's virtual store turns `(` into `_` and drops `)`. */
function storeDirName(version, suffix) {
  return `metro@${version}${suffix}`.replaceAll('(', '_').replaceAll(')', '')
}

test('the image-size override is a bounded 2.0.3 floor', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const range = pkg.pnpm?.overrides?.['image-size']
  assert.equal(range, '>=2.0.3 <3')
  assert.equal(isBounded(range), true)
})

test('pnpm-lock.yaml resolves only patched image-size and patches every Metro that uses it', () => {
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const workspace = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const osv = readFileSync(path.join(ROOT, 'osv-scanner.toml'), 'utf8')
  for (const id of ADVISORIES) {
    assert.equal(workspace.includes(id), false, `${id} is still ignored by pnpm`)
    assert.equal(osv.includes(id), false, `${id} is still ignored by osv-scanner`)
  }

  const resolved = new Set()
  for (const match of lock.matchAll(/^  image-size@(\d+\.\d+\.\d+):/gm)) resolved.add(match[1])
  for (const match of lock.matchAll(/^ {6}image-size: (\d+\.\d+\.\d+)$/gm)) resolved.add(match[1])
  assert.ok(resolved.size > 0, 'expected image-size to stay installed')
  for (const version of resolved) assertPatched(version, 'lockfile')

  const metros = metroSnapshotsUsingImageSize(lock)
  assert.deepEqual(
    metros.map((snapshot) => snapshot.version),
    ['0.83.5', '0.84.4'],
  )
  for (const { version, suffix } of metros) {
    assert.match(suffix, /patch_hash=/, `metro@${version} is not patched`)
    const patchPath = path.join(ROOT, 'patches', `metro@${version}.patch`)
    assert.equal(existsSync(patchPath), true, `missing ${patchPath}`)
    const patch = readFileSync(patchPath, 'utf8')
    const added = patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    assert.match(added.join('\n'), /_imageSize\.default\)\(_fs\.default\.readFileSync/)
    assert.equal(added.some((line) => line.includes('isImageInput')), false)
    assert.match(workspace, new RegExp(`metro@${version.replaceAll('.', '\\.')}`))
    assert.match(lock, new RegExp(`metro@${version.replaceAll('.', '\\.')}:\\n    hash:`))
    assert.match(lock, new RegExp(`path: patches/metro@${version.replaceAll('.', '\\.')}\\.patch`))
  }
})

test('installed Metro measures a PNG from its filename and rejects the old parser loops', async () => {
  const store = path.join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return
  const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const metros = metroSnapshotsUsingImageSize(lock)
  assert.ok(metros.length > 0, 'lockfile has no metro snapshot that depends on image-size')

  const dir = mkdtempSync(path.join(tmpdir(), 'mushi-image-size-'))
  const pngPath = path.join(dir, 'pixel.png')
  writeFileSync(pngPath, PNG)
  try {
    for (const snapshot of metros) {
      const name = storeDirName(snapshot.version, snapshot.suffix)
      const assets = path.join(store, name, 'node_modules', 'metro', 'src', 'Assets.js')
      assert.equal(existsSync(assets), true, `missing installed ${name}`)
      const source = readFileSync(assets, 'utf8')
      assert.match(source, /readFileSync\(assetInfo\.files\[0\]\)/, `${name} is not patched`)
      assert.doesNotMatch(source, /isImageInput/, `${name} still passes a filename`)

      const require = createRequire(assets)
      const imageSizePkg = path.join(store, name, 'node_modules', 'image-size', 'package.json')
      const version = JSON.parse(readFileSync(imageSizePkg, 'utf8')).version
      assertPatched(version, name)

      const { getAssetData, getAssetSize } = require(assets)
      const data = await getAssetData(pngPath, 'pixel.png', [], null, '/assets')
      assert.equal(data.width, 1, name)
      assert.equal(data.height, 1, name)
      assert.deepEqual(getAssetSize('png', PNG, pngPath), { width: 1, height: 1 })

      const probe = spawnSync(process.execPath, ['-e', probeSource(assets, pngPath)], {
        timeout: 2000,
        encoding: 'utf8',
      })
      assert.equal(
        probe.status,
        0,
        probe.stderr || probe.stdout || probe.error?.message || `${name} image-size probe failed`,
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function probeSource(assetsPath, pngPath) {
  return `
    const { createRequire } = require('node:module')
    const req = createRequire(${JSON.stringify(assetsPath)})
    const loaded = req('image-size')
    const fn = loaded && loaded.__esModule ? loaded.default : loaded
    if (typeof fn !== 'function') {
      console.error('require("image-size") default export is not a function')
      process.exit(2)
    }
    const icns = Buffer.alloc(16)
    icns.write('icns', 0, 'ascii')
    icns.writeUInt32BE(64, 4)
    icns.write('ICON', 8, 'ascii')
    icns.writeUInt32BE(0, 12)
    const jxl = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x4a, 0x58, 0x4c, 0x20])
    for (const buf of [icns, jxl]) {
      try {
        fn(buf)
        console.error('zero-size payload returned instead of throwing')
        process.exit(7)
      } catch (error) {
        if (!error || error.name !== 'TypeError') {
          console.error(error && error.stack)
          process.exit(3)
        }
      }
    }
    const png = require('node:fs').readFileSync(${JSON.stringify(pngPath)})
    const size = fn(png)
    if (!size || size.width !== 1 || size.height !== 1) {
      console.error('buffer size ' + JSON.stringify(size))
      process.exit(4)
    }
    try {
      fn(${JSON.stringify(pngPath)})
      console.error('filename was accepted')
      process.exit(6)
    } catch (error) {
      if (!error || error.name !== 'TypeError') process.exit(5)
    }
  `
}
