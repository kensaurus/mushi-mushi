/**
 * Tests for the AGENTS.md SDK-claim check in scripts/check-docs-versions.mjs
 * (scripts/lib/agents-version-claims.mjs) — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAgentsClaims } from './lib/agents-version-claims.mjs'

const doc = (core, coreCurrent, rn, rnCurrent) =>
  [
    `**Introduced in:** \`@mushi-mushi/core\` / \`@mushi-mushi/web\` **${core}** (current: **${coreCurrent}** — see root \`CHANGELOG.md\`).`,
    `\`@mushi-mushi/react-native\` **${rn}** (current: **${rnCurrent}**). Full doc:`,
  ].join('\n')

const versions = {
  '@mushi-mushi/core': '1.32.0',
  '@mushi-mushi/web': '1.32.0',
  '@mushi-mushi/react-native': '0.24.0',
}

test('passes when both claims match the workspace minor', () => {
  const r = checkAgentsClaims(doc('1.19.0', '1.32.4', '0.19.0', '0.24.1'), versions, false)
  assert.deepEqual(r.findings, [])
})

test('reports a stale react-native claim', () => {
  const r = checkAgentsClaims(doc('1.19.0', '1.32.0', '0.19.0', '0.21.0'), versions, false)
  assert.equal(r.findings.length, 1)
  assert.match(r.findings[0], /react-native SDK claim 0\.21\.0/)
})

test('accepts the web version while core and web diverge', () => {
  const r = checkAgentsClaims(doc('1.19.0', '1.32.0', '0.19.0', '0.24.0'), { ...versions, '@mushi-mushi/core': '1.33.0' }, false)
  assert.deepEqual(r.findings, [])
})

test('--write rewrites the current claim, not an equal Introduced-in version', () => {
  // Introduced in the same release the claim names: the first occurrence of
  // "1.31.0" is the Introduced-in version, which must stay.
  const r = checkAgentsClaims(doc('1.31.0', '1.31.0', '0.21.0', '0.21.0'), versions, true)
  assert.deepEqual(r.findings, [])
  assert.equal(r.text, doc('1.31.0', '1.32.0', '0.21.0', '0.24.0'))
  assert.equal(r.rewrites.length, 2)
})
