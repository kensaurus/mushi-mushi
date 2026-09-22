/**
 * Tests for scripts/lib/pack.mjs (packing, tarball sizes, extraction) and the budget logic in
 * scripts/check-install-size.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { extractTarball, tarballFileSizes } from './lib/pack.mjs'
import { BUDGETS, overBudget } from './check-install-size.mjs'

/** A minimal ustar archive: [{ name, body, type?, prefix? }]. */
function tar(entries) {
  const blocks = []
  for (const { name, body = '', type = '0', prefix = '' } of entries) {
    const data = Buffer.from(body)
    const header = Buffer.alloc(512)
    header.write(name, 0, 'utf8')
    header.write('0000644\0', 100)
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write(type, 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    header.write(prefix, 345)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

const paxRecord = (key, value) => {
  const body = ` ${key}=${value}\n`
  let len = body.length + 1
  while (`${len}${body}`.length !== len) len++
  return `${len}${body}`
}

test('tarballFileSizes counts regular files only, not directories or PAX headers', () => {
  const gz = tar([
    { name: 'package/', type: '5' },
    { name: 'package/package.json', body: '{"name":"x"}' },
    { name: 'package/dist/index.js', body: 'x'.repeat(1300) },
    { name: 'PaxHeader', type: 'x', body: paxRecord('path', 'package/long/name.js') },
    { name: 'package/short.js', body: 'abc' },
  ])
  const dir = mkdtempSync(join(tmpdir(), 'pack-test-'))
  try {
    const file = join(dir, 'x.tgz')
    writeFileSync(file, gz)
    assert.deepEqual(tarballFileSizes(file), { packed: gz.length, unpacked: 12 + 1300 + 3, files: 3 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractTarball writes files, applies ustar prefix and PAX paths, and refuses traversal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-test-'))
  try {
    const written = extractTarball(
      tar([
        { name: 'package.json', prefix: 'package', body: '{}' },
        { name: 'PaxHeader', type: 'x', body: paxRecord('path', 'package/dist/a-very-long-name.js') },
        { name: 'ignored-by-pax.js', body: 'export {}' },
      ]),
      dir,
    )
    assert.deepEqual(written, ['package/package.json', 'package/dist/a-very-long-name.js'])
    assert.equal(readFileSync(join(dir, 'package', 'dist', 'a-very-long-name.js'), 'utf8'), 'export {}')
    assert.throws(() => extractTarball(tar([{ name: 'package/../../evil.js', body: 'x' }]), dir), /unsafe tar path/)
    assert.throws(() => extractTarball(tar([{ name: '/etc/evil', body: 'x' }]), dir), /unsafe tar path/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('overBudget reports each exceeded dimension and nothing within budget', () => {
  const budget = { name: '@mushi-mushi/mcp', packed: 100, unpacked: 500 }
  assert.deepEqual(overBudget(budget, { packed: 100, unpacked: 500 }), [])
  const problems = overBudget(budget, { packed: 101, unpacked: 900 })
  assert.equal(problems.length, 2)
  assert.match(problems[0], /packed size .* exceeds/)
  assert.match(problems[1], /unpacked size .* exceeds/)
})

test('budgets exist for the two npx-launched packages', () => {
  assert.deepEqual(
    BUDGETS.map((b) => b.name),
    ['@mushi-mushi/mcp', '@mushi-mushi/cli'],
  )
})
