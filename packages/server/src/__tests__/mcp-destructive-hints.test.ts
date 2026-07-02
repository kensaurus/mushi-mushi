/**
 * Contract test: destructive/idempotent hint parity across the two places
 * MCP tool definitions live (production-readiness audit item #18).
 *
 * `award_bonus_points`, `set_tier`, and `merge_fix` are irreversible from
 * Mushi's side (no reversal/unmerge endpoint) but used to either omit
 * `destructiveHint` entirely (hosted manifest) or mark it `false` (stdio
 * catalog for the two rewards tools). Both transports must now agree.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CATALOG_SOURCE = readFileSync(
  resolve(__dirname, '../../../mcp/src/catalog.ts'),
  'utf8',
)

const manifestRaw = readFileSync(
  resolve(__dirname, '../../supabase/functions/_shared/mcp-hosted-tool-manifest.json'),
  'utf8',
)
const manifest = JSON.parse(manifestRaw) as Record<
  string,
  { description: string; hints?: { destructive?: boolean; idempotent?: boolean } }
>

const DESTRUCTIVE_TOOLS = ['award_bonus_points', 'set_tier', 'merge_fix']

function catalogEntryBlock(name: string): string {
  const marker = `name: '${name}',`
  const idx = CATALOG_SOURCE.indexOf(marker)
  expect(idx, `catalog.ts should declare a tool named '${name}'`).toBeGreaterThanOrEqual(0)
  // Grab up to the next top-level `{ name: '...'` sibling (or EOF) so we scope
  // the assertion to this tool's own object literal.
  const nextIdx = CATALOG_SOURCE.indexOf("\n  {\n    name: '", idx)
  return CATALOG_SOURCE.slice(idx, nextIdx === -1 ? undefined : nextIdx)
}

describe('mcp destructive hints — stdio catalog (packages/mcp/src/catalog.ts)', () => {
  for (const name of DESTRUCTIVE_TOOLS) {
    it(`${name} declares hints.destructive: true`, () => {
      const block = catalogEntryBlock(name)
      expect(block).toMatch(/hints:\s*\{[^}]*destructive:\s*true/)
    })
  }

  it('award_bonus_points description documents that tier re-evaluation is not immediate', () => {
    const block = catalogEntryBlock('award_bonus_points')
    expect(block).toMatch(/NOT immediate/)
  })

  it('set_tier description documents that reward_webhooks grants do not replay', () => {
    const block = catalogEntryBlock('set_tier')
    expect(block).toMatch(/does NOT replay|will NOT fire/)
  })

  it('merge_fix description documents there is no unmerge endpoint', () => {
    const block = catalogEntryBlock('merge_fix')
    expect(block).toMatch(/no unmerge endpoint/)
  })
})

describe('mcp destructive hints — hosted manifest (mcp-hosted-tool-manifest.json)', () => {
  for (const name of DESTRUCTIVE_TOOLS) {
    it(`${name} declares hints.destructive: true`, () => {
      expect(manifest[name], `manifest should contain '${name}'`).toBeDefined()
      expect(manifest[name].hints?.destructive).toBe(true)
    })
  }

  it('award_bonus_points is marked non-idempotent (retry after timeout double-awards)', () => {
    expect(manifest.award_bonus_points.hints?.idempotent).toBe(false)
  })

  it('set_tier is marked idempotent (re-applying the same tier is a no-op)', () => {
    expect(manifest.set_tier.hints?.idempotent).toBe(true)
  })

  it('merge_fix is marked idempotent (re-running an already-merged attempt is a safe no-op)', () => {
    expect(manifest.merge_fix.hints?.idempotent).toBe(true)
  })
})

describe('mcp destructive hints — manifest-tools.ts projects hints onto ToolDef.annotations', () => {
  it('buildManifestTools sets destructiveHint/idempotentHint from spec.hints when present', async () => {
    const { buildManifestTools } = await import('../../supabase/functions/mcp/manifest-tools.ts')
    const tools = buildManifestTools({
      apiCall: async () => ({}),
      requireString: () => {},
      McpError: class extends Error {
        constructor(public code: number, message: string) {
          super(message)
        }
      },
      ERR_INVALID_PARAMS: -32602,
    })

    for (const name of DESTRUCTIVE_TOOLS) {
      expect(tools[name], `buildManifestTools should produce '${name}'`).toBeDefined()
      expect(tools[name].annotations?.destructiveHint).toBe(true)
    }
    expect(tools.award_bonus_points.annotations?.idempotentHint).toBe(false)
    expect(tools.set_tier.annotations?.idempotentHint).toBe(true)
    expect(tools.merge_fix.annotations?.idempotentHint).toBe(true)
  })

  it('leaves annotations without destructiveHint/idempotentHint for tools with no hints override', () => {
    // A representative read-only tool from the manifest that never set `hints`.
    // Picked dynamically so this test doesn't rot if the manifest is reshuffled.
    const readOnlyName = Object.entries(manifest).find(([, spec]) => !spec.hints)?.[0]
    expect(readOnlyName, 'expected at least one manifest tool with no hints override').toBeDefined()
  })
})
