/**
 * FILE: scripts/mcp-configs.test.mjs
 * PURPOSE: Guard the MCP config linter behind scripts/check-cursor-plugin.mjs
 *          and scripts/check-mcp-publish-readiness.mjs.
 *
 * The cases are the three shipped defects this linter exists for:
 *   1. plugins/mushi-debugger/.mcp.json had a `url` and no `type`, so Claude
 *      Code installed the plugin and silently dropped its only server.
 *   2. The Cursor bundle pointed at https://your-project.supabase.co, used
 *      manifest fields Cursor does not read, and never declared the ${VAR}s
 *      its mcp.json needs.
 *   3. The MCP registry icon URL named a git-ignored PNG, so it 404ed.
 * The last block runs the linter over the real committed files, so a
 * regression in any of them fails here as well as in CI's plugin check.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  collectMcpServerEntries,
  collectVariableReferences,
  isTrackedFile,
  lintCursorManifest,
  lintMcpConfig,
  listTrackedJsonFiles,
  placeholderUrlReason,
  repoPathFromRawUrl,
} from './lib/mcp-configs.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOSTED = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp'

describe('collectMcpServerEntries', () => {
  it('finds entries at the top level and nested inside other objects', () => {
    const doc = {
      mcpServers: { a: { command: 'npx' } },
      plugins: [{ mcpServers: { b: { type: 'http', url: HOSTED } } }],
    }
    assert.deepEqual(
      collectMcpServerEntries(doc).map((e) => e.name),
      ['a', 'b'],
    )
  })

  it('skips a string mcpServers (a path to another file, as in plugin.json)', () => {
    assert.deepEqual(collectMcpServerEntries({ mcpServers: './.mcp.json' }), [])
  })
})

describe('lintMcpConfig — remote entries must declare a transport', () => {
  it('flags the shipped mushi-debugger shape: a url with no type', () => {
    const problems = lintMcpConfig({ mcpServers: { mushi: { url: HOSTED } } })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /"mushi" has a "url" but no "type"/)
  })

  for (const type of ['http', 'streamable-http', 'sse', 'ws']) {
    it(`accepts type "${type}"`, () => {
      assert.deepEqual(lintMcpConfig({ mcpServers: { mushi: { type, url: HOSTED } } }), [])
    })
  }

  it('rejects a url entry that calls itself stdio', () => {
    const problems = lintMcpConfig({ mcpServers: { mushi: { type: 'stdio', url: HOSTED } } })
    assert.match(problems.join('\n'), /"type": "stdio"/)
  })

  it('ignores stdio entries, which have no url', () => {
    const doc = { mcpServers: { local: { command: 'npx', args: ['-y', '@mushi-mushi/mcp'] } } }
    assert.deepEqual(lintMcpConfig(doc), [])
  })

  it('flags an empty url', () => {
    assert.match(lintMcpConfig({ mcpServers: { x: { type: 'http', url: '' } } })[0], /empty/)
  })
})

describe('lintMcpConfig — shipped configs may not point at a template host', () => {
  it('flags the Cursor bundle placeholder', () => {
    const doc = { mcpServers: { mushi: { type: 'http', url: 'https://your-project.supabase.co/functions/v1/mcp' } } }
    assert.match(lintMcpConfig(doc).join('\n'), /placeholder host "your-project.supabase.co"/)
  })

  it('allows placeholders in .example templates', () => {
    const doc = { mcpServers: { mushi: { type: 'http', url: 'https://your-project.supabase.co/functions/v1/mcp' } } }
    assert.deepEqual(lintMcpConfig(doc, { allowPlaceholderHosts: true }), [])
  })

  it('treats angle-bracket templates and non-URLs as invalid', () => {
    assert.match(placeholderUrlReason('https://<your-ref>.supabase.co/functions/v1/mcp'), /not a valid absolute URL/)
    assert.match(placeholderUrlReason('functions/v1/mcp'), /not a valid absolute URL/)
  })

  it('leaves ${VAR} URLs alone and passes the real hosted URL', () => {
    assert.equal(placeholderUrlReason('${MUSHI_MCP_URL}'), null)
    assert.equal(placeholderUrlReason(HOSTED), null)
    assert.equal(placeholderUrlReason('https://kensaur.us/mushi-mushi/hosted-mcp'), null)
  })
})

describe('Cursor manifest', () => {
  const mcp = {
    mcpServers: {
      'mushi-stdio': {
        type: 'stdio',
        command: 'npx',
        env: {
          MUSHI_API_KEY: '${MUSHI_API_KEY}',
          MUSHI_PROJECT_ID: '${MUSHI_PROJECT_ID:-}',
          HOME_DIR: '${env:HOME}',
          ROOT: '${CURSOR_PLUGIN_ROOT}/bin',
        },
      },
    },
  }

  it('collects user variables, not ${env:…} lookups or Cursor built-ins', () => {
    assert.deepEqual([...collectVariableReferences(mcp)].sort(), ['MUSHI_API_KEY', 'MUSHI_PROJECT_ID'])
  })

  it('flags every field outside Cursor’s manifest reference', () => {
    const manifest = {
      name: 'mushi-mushi',
      icon: './logo.png',
      categories: ['debugging'],
      mcp: { configFile: 'mcp.json' },
      minCursorVersion: '0.43.0',
    }
    const problems = lintCursorManifest(manifest, null).join('\n')
    for (const field of ['icon', 'categories', 'mcp', 'minCursorVersion']) {
      assert.match(problems, new RegExp(`field "${field}" is not in Cursor's manifest reference`))
    }
  })

  it('flags ${VAR}s the manifest does not declare', () => {
    const manifest = {
      name: 'mushi-mushi',
      variables: { type: 'object', properties: { MUSHI_API_KEY: { type: 'string' } } },
    }
    assert.deepEqual(lintCursorManifest(manifest, mcp), [
      'mcp.json uses ${MUSHI_PROJECT_ID} but plugin.json "variables" does not declare it',
    ])
  })

  it('rejects a name that is not lowercase kebab-case', () => {
    assert.match(lintCursorManifest({ name: 'Mushi Mushi' }, null).join('\n'), /kebab-case/)
  })
})

describe('repoPathFromRawUrl', () => {
  it('maps the registry icon URL to its repo path', () => {
    assert.deepEqual(
      repoPathFromRawUrl('https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/packages/brand/src/logo-mark-512.png'),
      { ref: 'master', path: 'packages/brand/src/logo-mark-512.png' },
    )
  })

  it('returns null for other hosts, other repos and malformed URLs', () => {
    assert.equal(repoPathFromRawUrl('https://kensaur.us/mushi-mushi/logo.png'), null)
    assert.equal(repoPathFromRawUrl('https://raw.githubusercontent.com/someone/else/master/logo.png'), null)
    assert.equal(repoPathFromRawUrl('https://raw.githubusercontent.com/kensaurus/mushi-mushi/master'), null)
    assert.equal(repoPathFromRawUrl('not a url'), null)
  })
})

describe('committed files', () => {
  it('every tracked MCP config lints clean', () => {
    const configs = listTrackedJsonFiles(ROOT).filter((rel) =>
      readFileSync(resolve(ROOT, rel), 'utf8').includes('"mcpServers"'),
    )
    assert.ok(configs.includes('plugins/mushi-debugger/.mcp.json'), 'the Claude Code plugin config is tracked')
    assert.ok(configs.includes('packages/cursor-plugin/mcp.json'), 'the Cursor plugin config is tracked')
    for (const rel of configs) {
      const doc = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'))
      assert.deepEqual(lintMcpConfig(doc, { allowPlaceholderHosts: rel.endsWith('.example') }), [], rel)
    }
  })

  it('the Cursor manifest passes its own lint', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'packages/cursor-plugin/.cursor-plugin/plugin.json'), 'utf8'))
    const mcp = JSON.parse(readFileSync(resolve(ROOT, 'packages/cursor-plugin/mcp.json'), 'utf8'))
    assert.deepEqual(lintCursorManifest(manifest, mcp), [])
  })

  it('every server.json icon served from this repo is tracked by git', () => {
    const server = JSON.parse(readFileSync(resolve(ROOT, 'packages/mcp/server.json'), 'utf8'))
    assert.ok(server.icons?.length > 0, 'server.json declares an icon')
    for (const icon of server.icons) {
      const local = repoPathFromRawUrl(icon.src)
      if (!local) continue
      assert.ok(isTrackedFile(ROOT, local.path), `${local.path} must be committed or ${icon.src} 404s`)
    }
  })
})
