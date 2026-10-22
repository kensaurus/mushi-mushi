/**
 * FILE: scripts/check-env-source-parity.test.mjs
 * PURPOSE: Lock the BL-019 gate: every env name read in source is documented
 *          or allowlisted, and strict mode (no --warn) exits 0.
 *
 * USAGE: node --test scripts/check-env-source-parity.test.mjs
 *        Included in `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = resolve(ROOT, 'scripts/check-env-source-parity.mjs')

test('strict env-source-parity exits 0', () => {
  const res = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`)
  assert.match(res.stdout, /every env name read in source is documented/)
})

test('json report has no undocumented names', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr)
  const report = JSON.parse(res.stdout)
  assert.equal(report.undocumented.length, 0)
  assert.ok(report.readNames > 0)
  assert.ok(report.documentedNames > 0)
})
