/**
 * The bounties site advertises /mushi-mushi/testers/og-card.png. That file
 * has to be the 1200×630 card and not dropped by the repo-wide *.png ignore,
 * or the share image 404s. Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REL = 'apps/testers/public/og-card.png'

function gitIgnores(rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT })
    return true
  } catch (err) {
    if (err && err.status === 1) return false
    throw err
  }
}

test('sync ships the bounties og:image and git keeps it', () => {
  execFileSync('node', ['scripts/sync-docs-og-card.mjs'], { cwd: ROOT })
  const dest = join(ROOT, REL)
  assert.equal(existsSync(dest), true, `${REL} is missing, so the bounties og:image 404s`)
  const png = readFileSync(dest)
  const src = readFileSync(join(ROOT, 'docs/social-preview/og-card.png'))
  assert.deepEqual(png, src)
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  assert.deepEqual(
    { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    { width: 1200, height: 630 },
  )
  assert.equal(gitIgnores(REL), false, `${REL} is gitignored, so the deploy never receives it`)
})
