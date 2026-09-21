/**
 * FILE: scripts/release-workflow.test.mjs
 * PURPOSE: Pin the supply-chain properties of the npm publish workflow that
 *          only a real release would otherwise exercise.
 *          - No long-lived npm token in the job npm's Trusted Publisher trusts.
 *          - mcp-publisher is a pinned, checksum-verified release, the same one
 *            in both workflows that run it.
 *          - Post-publish steps survive a failure in a sibling step.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const release = read('.github/workflows/release.yml')
const registry = read('.github/workflows/publish-mcp-registry.yml')
const bootstrap = read('.github/workflows/npm-bootstrap.yml')

function pin(text, key) {
  const m = text.match(new RegExp(`${key}:\\s*(\\S+)`))
  return m?.[1]
}

describe('release.yml publish credentials', () => {
  it('has no long-lived npm token anywhere in the file', () => {
    assert.doesNotMatch(release, /secrets\.NPM_TOKEN/)
    assert.doesNotMatch(release, /^\s+NODE_AUTH_TOKEN:/m)
  })

  it('defaults to a read-only GITHUB_TOKEN', () => {
    assert.match(release, /\npermissions:\n\s+contents: read\n/)
  })

  it('keeps the token-based first publish in the manual, environment-gated workflow', () => {
    assert.match(bootstrap, /workflow_dispatch:/)
    assert.match(bootstrap, /environment: npm-bootstrap/)
    assert.doesNotMatch(bootstrap, /^\s+id-token:\s*write/m)
    assert.match(bootstrap, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/)
  })

  it('stops a release that would need a bootstrap before anything publishes', () => {
    const guard = release.indexOf('bootstrap-new-packages.mjs --check')
    const publish = release.indexOf('publish: pnpm release')
    assert.ok(guard > 0 && guard < publish, 'the --check guard must run before changesets publishes')
  })
})

describe('mcp-publisher binary', () => {
  for (const [name, text] of [
    ['release.yml', release],
    ['publish-mcp-registry.yml', registry],
  ]) {
    it(`${name} downloads a pinned release and verifies its sha256`, () => {
      assert.doesNotMatch(text, /releases\/latest/)
      assert.match(pin(text, 'MCP_PUBLISHER_VERSION') ?? '', /^v\d+\.\d+\.\d+$/)
      assert.match(pin(text, 'MCP_PUBLISHER_SHA256') ?? '', /^[0-9a-f]{64}$/)
      assert.match(text, /sha256sum -c -/)
    })
  }

  it('both workflows run the same binary', () => {
    assert.equal(pin(release, 'MCP_PUBLISHER_VERSION'), pin(registry, 'MCP_PUBLISHER_VERSION'))
    assert.equal(pin(release, 'MCP_PUBLISHER_SHA256'), pin(registry, 'MCP_PUBLISHER_SHA256'))
  })
})

describe('post-publish steps', () => {
  const stepIf = (name) => {
    const at = release.indexOf(`- name: ${name}`)
    assert.ok(at > 0, `step "${name}" not found`)
    const next = release.indexOf('\n      - ', at + 1)
    const block = release.slice(at, next === -1 ? undefined : next)
    return block.match(/\n\s+if: (.+)/)?.[1] ?? ''
  }

  for (const name of [
    'Audit signatures of installed dependencies',
    'Aggregate public changelog',
    'Commit aggregated changelog',
    'Publish MCP server to the official registry',
    'Sync published versions to sdk_versions catalog',
    'Published packages summary',
  ]) {
    it(`"${name}" still runs when a sibling post-publish step failed`, () => {
      const cond = stepIf(name)
      // `!` cannot start a bare YAML scalar, so the status function must sit
      // inside ${{ }}; and the step must still require the publish itself.
      assert.match(cond, /^\$\{\{ !cancelled\(\) && steps\.changesets\.outcome == 'success' && /)
    })
  }
})
