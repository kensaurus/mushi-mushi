/**
 * FILE: scripts/check-admin-docs-coverage.test.mjs
 * PURPOSE: The public `/email/reporter` page is an end-user email link, not a
 *          console page, so the coverage check must not ask for
 *          apps/docs/content/admin/email-reporter.mdx.
 *
 * USAGE: node --test scripts/check-admin-docs-coverage.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./check-admin-docs-coverage.mjs', import.meta.url))

/**
 * The warn path prints gaps with console.warn and exits 0, so both streams
 * are captured (spawnSync returns stdout and stderr; no temp files).
 */
function runCoverage() {
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, ADMIN_DOCS_COVERAGE_STRICT: '' },
  })
  const stdout = res.stdout ?? ''
  const stderr = res.stderr ?? ''
  if (res.error || res.status !== 0) {
    const error = res.error ?? new Error(`check-admin-docs-coverage exited ${res.status}`)
    error.message = `${error.message}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
    throw error
  }
  return { stdout, stderr }
}

test('public /email/reporter is not flagged as an undocumented console page', () => {
  const { stdout, stderr } = runCoverage()
  assert.equal(stdout.includes('/email/reporter'), false, stdout)
  assert.equal(stderr.includes('/email/reporter'), false, stderr)
})
