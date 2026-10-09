/**
 * Tests for scripts/check-workflow-expressions.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSecretsInIf } from './check-workflow-expressions.mjs'

const step = (cond) => ['jobs:', '  a:', '    steps:', '      - name: x', `        if: ${cond}`, '        run: echo'].join('\n')

test('flags dot access to secrets in an if:', () => {
  const hits = findSecretsInIf(step("${{ !inputs.dry_run && secrets.VSCE_PAT != '' }}"))
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 5)
})

test('flags bracket access to secrets in an if:', () => {
  assert.equal(findSecretsInIf(step("${{ secrets['VSCE_PAT'] != '' }}")).length, 1)
  assert.equal(findSecretsInIf(step("${{ secrets[format('{0}_TOKEN', inputs.env)] != '' }}")).length, 1)
  assert.equal(findSecretsInIf(step("${{ secrets [ 'X' ] }}")).length, 1)
})

test('flags secrets on a continuation line of a block scalar', () => {
  const text = ['steps:', '  - name: x', '    if: >-', "      github.event_name == 'push' &&", "      secrets['X'] != ''", '    run: echo'].join('\n')
  assert.equal(findSecretsInIf(text).length, 1)
})

test('allows env booleans and secrets outside if:', () => {
  const text = [
    'env:',
    "  HAS_TOKEN: ${{ secrets.MY_TOKEN != '' }}",
    'steps:',
    '  - name: x',
    "    if: ${{ env.HAS_TOKEN == 'true' }}",
    '    run: echo',
  ].join('\n')
  assert.deepEqual(findSecretsInIf(text), [])
})
