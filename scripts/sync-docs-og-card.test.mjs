/**
 * A build of one app must refresh only its own og-card copy.
 * Run with `pnpm test:scripts`.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { copyOgCard, ogCardDestinations } from './sync-docs-og-card.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts/sync-docs-og-card.mjs')

/** Sync invocations in a npm prebuild string: `sync-docs-og-card.mjs [target]`. */
function syncInvocations(prebuild) {
  return [...prebuild.matchAll(/sync-docs-og-card\.mjs(?:\s+(\S+))?/g)].map((match) => match[1] ?? '')
}

test('each app prebuild syncs only its own og-card', () => {
  const docs = JSON.parse(readFileSync(join(ROOT, 'apps/docs/package.json'), 'utf8'))
  const testers = JSON.parse(readFileSync(join(ROOT, 'apps/testers/package.json'), 'utf8'))
  assert.deepEqual(syncInvocations(docs.scripts.prebuild), ['docs'])
  assert.deepEqual(syncInvocations(testers.scripts.prebuild), ['testers'])
})

test('a named target copies only that app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'og-card-'))
  try {
    await mkdir(join(root, 'docs/social-preview'), { recursive: true })
    await writeFile(join(root, 'docs/social-preview/og-card.png'), 'source-png')

    const testersWritten = await copyOgCard(root, 'testers')
    assert.deepEqual(testersWritten, ogCardDestinations(root, 'testers'))
    assert.equal(await readFile(testersWritten[0], 'utf8'), 'source-png')
    await assert.rejects(stat(ogCardDestinations(root, 'docs')[0]))

    const docsWritten = await copyOgCard(root, 'docs')
    assert.deepEqual(docsWritten, ogCardDestinations(root, 'docs'))
    assert.equal(await readFile(docsWritten[0], 'utf8'), 'source-png')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('no target still refreshes both copies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'og-card-'))
  try {
    await mkdir(join(root, 'docs/social-preview'), { recursive: true })
    await writeFile(join(root, 'docs/social-preview/og-card.png'), 'both')
    const written = await copyOgCard(root)
    assert.deepEqual(written, ogCardDestinations(root))
    assert.equal(written.length, 2)
    for (const dest of written) assert.equal(await readFile(dest, 'utf8'), 'both')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unknown target fails before copying', () => {
  assert.throws(() => ogCardDestinations('/repo', 'both'), /unknown og-card target/)
  const result = spawnSync(process.execPath, [SCRIPT, 'both'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown og-card target/)
})
