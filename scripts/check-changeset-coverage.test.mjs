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
import {
  findUncovered,
  isLicenseHeaderOnlyPatch,
  isShippedSource,
  isVersionPinOnlyPatch,
  parseChangesetTargets,
} from './check-changeset-coverage.mjs'

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

test('isLicenseHeaderOnlyPatch accepts SPDX/copyright header edits and nothing else', () => {
  const header = [
    'diff --git a/packages/node/src/hono.ts b/packages/node/src/hono.ts',
    '--- a/packages/node/src/hono.ts',
    '+++ b/packages/node/src/hono.ts',
    '@@ -0,0 +1,2 @@',
    '+// SPDX-License-Identifier: MIT',
    '+// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi',
  ].join('\n')
  assert.equal(isLicenseHeaderOnlyPatch(header), true)
  assert.equal(isLicenseHeaderOnlyPatch(header.replace(/\n/g, '\r\n')), true)
  assert.equal(isLicenseHeaderOnlyPatch(`${header}\n+export const x = 1`), false)
  assert.equal(isLicenseHeaderOnlyPatch(`${header}\n-// a different comment`), false)
  assert.equal(isLicenseHeaderOnlyPatch(`${header}\n+/** @deprecated */`), false)
  // An empty patch is not "header only": nothing changed, so nothing to exempt.
  assert.equal(isLicenseHeaderOnlyPatch(''), false)
})

test('findUncovered drops files whose change is license headers only', () => {
  const uncovered = findUncovered({
    changedFiles: ['packages/mcp/src/server.ts', 'packages/cli/src/init.ts'],
    packages: PACKAGES,
    ignored: new Set(),
    covered: new Set(),
    isHeaderOnly: (file) => file === 'packages/cli/src/init.ts',
  })
  assert.deepEqual(
    uncovered.map((u) => u.name),
    ['@mushi-mushi/mcp'],
  )
})

// The "chore: version packages" PR (#423) rewrites only the MCP pin in cli and
// mcp source (scripts/sync-mcp-pin.mjs) and consumes the changesets. That is the
// release itself; flagging it put a red X on every version PR.
const VERSION_PR_CLI_PATCH = [
  'diff --git a/packages/cli/src/version.ts b/packages/cli/src/version.ts',
  '--- a/packages/cli/src/version.ts',
  '+++ b/packages/cli/src/version.ts',
  '@@ -24 +24 @@ export const MUSHI_CLI_VERSION: string =',
  "-export const MUSHI_MCP_PIN_SPEC = '@mushi-mushi/mcp@0.22.0'",
  "+export const MUSHI_MCP_PIN_SPEC = '@mushi-mushi/mcp@0.22.1'",
].join('\n')

test('isVersionPinOnlyPatch accepts the version PR pin bump', () => {
  assert.equal(isVersionPinOnlyPatch(VERSION_PR_CLI_PATCH), true)
  // Two pins on one line, CRLF patch, prerelease pin.
  assert.equal(
    isVersionPinOnlyPatch("-  a: '@mushi-mushi/mcp@0.21.9', b: '@mushi-mushi/mcp@0.21.9',\r\n+  a: '@mushi-mushi/mcp@0.22.0', b: '@mushi-mushi/mcp@0.22.0',\r\n"),
    true,
  )
  assert.equal(isVersionPinOnlyPatch("-x('@mushi-mushi/mcp@1.0.0-rc.1')\n+x('@mushi-mushi/mcp@1.0.0')"), true)
})

test('isVersionPinOnlyPatch rejects any change beyond the pin', () => {
  // The pin moved AND the line changed.
  assert.equal(
    isVersionPinOnlyPatch("-const PIN = '@mushi-mushi/mcp@0.22.0'\n+export const PIN = '@mushi-mushi/mcp@0.22.1'"),
    false,
  )
  // A real code change next to the pin bump.
  assert.equal(isVersionPinOnlyPatch(`${VERSION_PR_CLI_PATCH}\n+export const extra = 1`), false)
  // No pin at all, only additions, only removals, empty.
  assert.equal(isVersionPinOnlyPatch('-const a = 1\n+const a = 2'), false)
  assert.equal(isVersionPinOnlyPatch("+'@mushi-mushi/mcp@0.22.1'"), false)
  assert.equal(isVersionPinOnlyPatch("-'@mushi-mushi/mcp@0.22.0'"), false)
  assert.equal(isVersionPinOnlyPatch(''), false)
  // Another package's version is not the generated pin.
  assert.equal(isVersionPinOnlyPatch("-'@mushi-mushi/core@1.0.0'\n+'@mushi-mushi/core@1.1.0'"), false)
})

test('findUncovered passes a version PR whose only source change is the pin', () => {
  const pinOnly = new Set(['packages/cli/src/version.ts', 'packages/mcp/src/clients.ts'])
  const uncovered = findUncovered({
    changedFiles: ['packages/cli/src/version.ts', 'packages/mcp/src/clients.ts', 'packages/mcp/package.json', 'packages/mcp/CHANGELOG.md'],
    packages: PACKAGES,
    ignored: new Set(),
    covered: new Set(), // the version PR consumed every changeset
    isHeaderOnly: (f) => pinOnly.has(f),
  })
  assert.deepEqual(uncovered, [])
})
