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
