/**
 * Regression test for the public site audit finding: the static, unauthenticated
 * MCP server-card (.well-known/mcp/server-card.json — what Smithery and other
 * directory scanners read before a client ever authenticates) used to be built
 * straight from mcp-hosted-tool-manifest.json, which omits every tool hand-coded
 * in mcp/index.ts's BASE_TOOLS (get_fix_context, dispatch_fix, and the rest of
 * the incident-loop). The card now sources its tool list from
 * mcp-discovery-tools.json, generated from the canonical catalog — see
 * scripts/sync-mcp-discovery-card.mjs.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const REPO_ROOT = resolve(__dirname, '../../../..')

describe('mcp server card', () => {
  it('advertises incident-loop tools that only exist in BASE_TOOLS, not in mcp-hosted-tool-manifest.json', async () => {
    const { buildMcpServerCard } = await import('../../supabase/functions/_shared/mcp-server-card.ts')
    const card = buildMcpServerCard() as { tools: Array<{ name: string }> }
    const names = card.tools.map((t) => t.name)

    expect(names).toContain('get_fix_context')
    expect(names).toContain('dispatch_fix')
  })

  it('every tool has a non-empty description', async () => {
    const { buildMcpServerCard } = await import('../../supabase/functions/_shared/mcp-server-card.ts')
    const card = buildMcpServerCard() as { tools: Array<{ name: string; description: string }> }
    for (const tool of card.tools) {
      expect(tool.description.length, `${tool.name} should have a description`).toBeGreaterThan(0)
    }
  })

  it('advertises real input schemas, catalog titles and annotations (not empty objects and name.replace)', async () => {
    const { buildMcpServerCard } = await import('../../supabase/functions/_shared/mcp-server-card.ts')
    const card = buildMcpServerCard() as {
      tools: Array<{
        name: string
        title: string
        inputSchema: { properties?: Record<string, unknown>; required?: string[] }
        annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
      }>
    }
    const merge = card.tools.find((t) => t.name === 'merge_fix')!
    expect(merge.title).toBe('Merge fix PR')
    expect(merge.inputSchema.required).toContain('fixId')
    expect(merge.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    const refresh = card.tools.find((t) => t.name === 'refresh_ci')!
    expect(refresh.annotations?.destructiveHint).toBe(false)
    for (const tool of card.tools) {
      expect(tool.title, tool.name).not.toBe(tool.name.replace(/_/g, ' '))
      expect(tool.annotations, `${tool.name} annotations`).toBeDefined()
    }
  })

  it('offers OAuth alongside API keys, lists resources, and reports the npm package version', async () => {
    const { buildMcpServerCard } = await import('../../supabase/functions/_shared/mcp-server-card.ts')
    const oauth = {
      authorizationServer: 'https://example.supabase.co/functions/v1/mcp',
      resourceMetadata: 'https://example.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource',
    }
    const card = buildMcpServerCard(oauth) as {
      serverInfo: { version: string }
      authentication: { schemes: string[]; oauth2: Record<string, unknown> }
      configSchema: { required?: string[] }
      resources: Array<{ uri: string }>
    }
    expect(card.authentication.schemes).toEqual(['oauth2', 'apiKey'])
    expect(card.authentication.oauth2).toMatchObject(oauth)
    // An OAuth client needs no key, so the Smithery config must not require one.
    expect(card.configSchema.required ?? []).not.toContain('mushiApiKey')
    expect(card.resources.map((r) => r.uri)).toContain('project://dashboard')
    const mcpPackage = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages/mcp/package.json'), 'utf8')) as {
      version: string
    }
    expect(card.serverInfo.version).toBe(mcpPackage.version)
  })

  it('mcp-discovery-tools.json is in sync with the canonical catalog', () => {
    const catalogDist = resolve(REPO_ROOT, 'packages/mcp/dist/catalog.js')
    if (!existsSync(catalogDist)) {
      // Dist is a build artifact — skip in environments where it hasn't been
      // built yet rather than failing on a missing prerequisite.
      return
    }
    expect(() =>
      execFileSync('node', [resolve(REPO_ROOT, 'scripts/sync-mcp-discovery-card.mjs'), '--check']),
    ).not.toThrow()
  })
})
