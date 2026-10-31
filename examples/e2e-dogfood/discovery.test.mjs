/**
 * FILE: examples/e2e-dogfood/discovery.test.mjs
 * PURPOSE: Package `pnpm test` must prove Playwright still discovers the suite.
 *          An echo that exits 0 does not.
 *
 * `playwright test --list` on the base of the comment edit (8bb435771^) and
 * on the revised tree both printed: Total: 345 tests in 96 files.
 *
 * USAGE: pnpm --filter @mushi-mushi/e2e-dogfood test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))

/** Matched totals from `playwright test --list` on the base and revised trees. */
const DISCOVERED = { tests: 345, files: 96 }

test('playwright test --list matches the pre-edit discovery total', () => {
  const out = execFileSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--list', '--reporter=list'],
    { cwd: DIR, encoding: 'utf8' },
  )
  const total = out.match(/^Total: (\d+) tests in (\d+) files$/m)
  assert.ok(total, 'playwright test --list did not print a total')
  assert.equal(
    Number(total[1]),
    DISCOVERED.tests,
    'base and revised both listed 345 tests; a comment edit must not change that',
  )
  assert.equal(
    Number(total[2]),
    DISCOVERED.files,
    'base and revised both listed 96 files; a comment edit must not change that',
  )
})
