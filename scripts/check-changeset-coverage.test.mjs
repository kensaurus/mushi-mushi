/**
 * Tests for scripts/check-changeset-coverage.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findUncovered, isShippedSource, parseChangesetTargets } from './check-changeset-coverage.mjs'

const PACKAGES = [
  { dir: 'core', name: '@mushi-mushi/core' },
  { dir: 'mcp', name: '@mushi-mushi/mcp' },
  { dir: 'cli', name: '@mushi-mushi/cli' },
  { dir: 'server', name: '@mushi-mushi/server', private: true },
  { dir: 'brand', name: '@mushi-mushi/brand' },
]

test('parseChangesetTargets reads the frontmatter map in any quoting style', () => {
  const targets = parseChangesetTargets(
    "---\n'@mushi-mushi/core': minor\n\"@mushi-mushi/web\": patch\nmushi-mushi: major\n---\n\nBody: not: a target\n",
  )
  assert.deepEqual([...targets].sort(), ['@mushi-mushi/core', '@mushi-mushi/web', 'mushi-mushi'])
  assert.equal(parseChangesetTargets('no frontmatter').size, 0)
  assert.equal(parseChangesetTargets("---\r\n'@mushi-mushi/cli': minor\r\n---\r\n").size, 1)
})

test('isShippedSource keeps src and drops tests, snapshots, mocks and non-src files', () => {
  assert.equal(isShippedSource('src/server.ts'), true)
  assert.equal(isShippedSource('src/commands/account.ts'), true)
  assert.equal(isShippedSource('src/__tests__/server.test.ts'), false)
  assert.equal(isShippedSource('src/event-tracker.test.ts'), false)
  assert.equal(isShippedSource('src/widget.spec.tsx'), false)
  assert.equal(isShippedSource('src/__snapshots__/styles.test.ts.snap'), false)
  assert.equal(isShippedSource('src/__mocks__/fetch.ts'), false)
  assert.equal(isShippedSource('README.md'), false)
  assert.equal(isShippedSource('package.json'), false)
  assert.equal(isShippedSource('CONTRIBUTING.md'), false)
})

test('findUncovered reports exactly the changed publishable packages without a changeset', () => {
  const uncovered = findUncovered({
    changedFiles: [
      'packages/core/src/event-tracker.ts', // covered below
      'packages/mcp/src/server.ts',
      'packages/mcp/src/catalog.ts',
      'packages/mcp/README.md', // not shipped source
      'packages/cli/src/__tests__/status.test.ts', // test only
      'packages/server/src/index.ts', // private
      'packages/brand/src/index.js', // ignored in changeset config
      'apps/admin/src/App.tsx', // not a package
    ],
    packages: PACKAGES,
    ignored: new Set(['@mushi-mushi/brand']),
    covered: new Set(['@mushi-mushi/core']),
  })
  assert.deepEqual(uncovered, [
    {
      name: '@mushi-mushi/mcp',
      dir: 'mcp',
      files: ['packages/mcp/src/server.ts', 'packages/mcp/src/catalog.ts'],
    },
  ])
})

test('an unresolvable base ref fails loudly instead of passing', () => {
  const script = fileURLToPath(new URL('./check-changeset-coverage.mjs', import.meta.url))
  const res = spawnSync(process.execPath, [script, '--base', 'refs/heads/does-not-exist-anywhere'], {
    encoding: 'utf8',
  })
  assert.equal(res.status, 2)
  assert.match(res.stderr, /cannot resolve a merge-base/)
})

test('the gate still runs when invoked through a symlink', (t) => {
  // Node resolves the entry module through links but leaves argv[1] as typed;
  // a guard that compares the two unresolved would skip main() and exit 0.
  // A directory junction needs no privileges on Windows; elsewhere the type is
  // ignored and this is an ordinary directory symlink.
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'changeset-coverage-link-'))
  const link = join(dir, 'scripts')
  try {
    try {
      symlinkSync(scriptsDir, link, 'junction')
    } catch (err) {
      t.skip(`directory links unavailable here (${err.code})`)
      return
    }
    const res = spawnSync(
      process.execPath,
      [join(link, 'check-changeset-coverage.mjs'), '--base', 'refs/heads/does-not-exist-anywhere'],
      { encoding: 'utf8' },
    )
    assert.equal(res.status, 2)
    assert.match(res.stderr, /cannot resolve a merge-base/)
  } finally {
    // Remove the link itself first so the recursive delete never walks into
    // the real scripts/ folder through it.
    try {
      unlinkSync(link)
    } catch {
      // already removed
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
