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
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./check-admin-docs-coverage.mjs', import.meta.url))

/**
 * The warn path prints gaps with console.warn and exits 0. execFileSync
 * returns only stdout then, so both streams are captured on files.
 */
function runCoverage() {
  const dir = mkdtempSync(join(tmpdir(), 'admin-docs-coverage-'))
  const stdoutPath = join(dir, 'stdout.txt')
  const stderrPath = join(dir, 'stderr.txt')
  const stdoutFd = openSync(stdoutPath, 'w')
  const stderrFd = openSync(stderrPath, 'w')
  let error
  try {
    execFileSync(process.execPath, [SCRIPT], {
      stdio: ['ignore', stdoutFd, stderrFd],
      env: { ...process.env, ADMIN_DOCS_COVERAGE_STRICT: '' },
    })
  } catch (err) {
    error = err
  } finally {
    closeSync(stdoutFd)
    closeSync(stderrFd)
  }
  const stdout = readFileSync(stdoutPath, 'utf8')
  const stderr = readFileSync(stderrPath, 'utf8')
  rmSync(dir, { recursive: true, force: true })
  if (error) {
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
