/**
 * FILE: scripts/e2e-dogfood-discovery.test.mjs
 * PURPOSE: Lock the e2e-dogfood package test to the Playwright discovery check.
 *          The previous script printed a message and exited 0, so a green
 *          package test said nothing about which tests Playwright still lists.
 *
 * DEPENDENCIES: node:test, node:fs, node:assert
 *
 * USAGE: pnpm test:scripts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PKG = new URL('../examples/e2e-dogfood/package.json', import.meta.url)

test('e2e-dogfood test script checks Playwright discovery', () => {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
  assert.equal(pkg.scripts.test, 'node --test ./discovery.test.mjs')
})
