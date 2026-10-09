/**
 * Tests for scripts/check-dependency-overrides.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBounded, suggestBound } from './check-dependency-overrides.mjs'

test('bounded ranges pass', () => {
  for (const range of [
    '^8.5.18',
    '~3.1.4',
    '1.2.3',
    '=1.2.3',
    '>=3.15.2 <4',
    '>=0.9.12 <0.10',
    '1.2.3 - 2.3.4',
    'npm:pkg@^1.2.3',
  ]) {
    assert.equal(isBounded(range), true, range)
  }
})

test('an inclusive ceiling (<=) is a ceiling', () => {
  assert.equal(isBounded('<=4'), true)
  assert.equal(isBounded('>=3.15.2 <=3.99.0'), true)
  assert.equal(isBounded('>=3.15.2 <= 4'), true)
})

test('wildcard ranges are bounded by their fixed part', () => {
  for (const range of ['3.x', '3.X', '3.*', '3.1.x', '3.x.x', 'npm:pkg@3.x']) {
    assert.equal(isBounded(range), true, range)
  }
})

test('open-ended ranges fail', () => {
  for (const range of ['>=3.15.2', '>4', '*', 'x', 'latest', '', 'npm:pkg@>=1.0.0']) {
    assert.equal(isBounded(range), false, range)
  }
})

test('suggestBound caps at the next major, or the next minor for 0.x', () => {
  assert.equal(suggestBound('>=3.15.2'), '>=3.15.2 <4')
  assert.equal(suggestBound('>=0.9.12'), '>=0.9.12 <0.10')
  assert.equal(suggestBound('latest'), null)
})
