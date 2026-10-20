/**
 * FILE: scripts/confirmation-coverage-skip.test.mjs
 * PURPOSE: Lock BL-064 — confirmation-coverage must not skip a missing control.
 *
 * OVERVIEW:
 * Reads the Playwright spec and rejects a runtime test.skip(). The only
 * allowed skip is the credential guard at the top of the describe.
 *
 * DEPENDENCIES: node:test, node:fs, node:assert
 *
 * USAGE: pnpm test:scripts
 *
 * NOTES: A bare test.skip() marks the test skipped, so CI can go green
 * without ever seeing the confirm dialog.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SPEC = new URL('../examples/e2e-dogfood/tests/confirmation-coverage.spec.ts', import.meta.url)

function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('confirmation-coverage skips only when credentials are missing', () => {
  const src = codeOnly(readFileSync(SPEC, 'utf8'))
  const skips = src.match(/test\.skip\(/g) ?? []
  assert.equal(skips.length, 1, 'a runtime test.skip() lets the spec pass without asserting')
  assert.match(src, /test\.skip\(\s*!SUPABASE_URL/)
  assert.match(src, /Requires VITE_SUPABASE_URL/)
  assert.equal(src.includes('test.skip()'), false)
  assert.equal(src.includes('testInfo.skip'), false)
  // Every surface requires its control. Dropping one re-opens the gap.
  assert.equal((src.match(/await requireControl\(/g) ?? []).length, 10)
})
