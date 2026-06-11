/**
 * Contract test: HTTP MCP edge function (`supabase/functions/mcp/index.ts`)
 * applies the same scope filter and outputSchema patterns as the stdio
 * MCP server (`packages/mcp/src/server.ts`).
 *
 * Why a source-level test (no Deno runtime):
 * The Edge Function imports Deno-globals (`Deno.serve`, `Deno.env`) that
 * we cannot evaluate from Node. Spinning up `supabase functions serve`
 * inside vitest is too slow for unit tests. Instead this file reads the
 * source verbatim and asserts on the structural invariants that the audit
 * (Round 8 backlog item B3) flagged as drift between the two transports.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = readFileSync(
  resolve(__dirname, '../../supabase/functions/mcp/index.ts'),
  'utf8',
)

describe('mcp http edge function — scope filter parity (B3)', () => {
  it('handleToolsList accepts a CallContext so it can filter by scope', () => {
    expect(SOURCE).toMatch(/function handleToolsList\(ctx: CallContext\)/)
  })

  it('tools/list dispatch passes the call context to handleToolsList', () => {
    expect(SOURCE).toMatch(/handleToolsList\(ctx\)/)
  })

  it('handleToolsList filters by isToolGrantedToScope before mapping', () => {
    expect(SOURCE).toMatch(/\.filter\(\(\[, def\]\) => isToolGrantedToScope/)
  })

  it('isToolGrantedToScope grants mcp:read tools to both scopes but write only to mcp:write', () => {
    expect(SOURCE).toMatch(/if \(required === 'mcp:read'\) return true/)
    expect(SOURCE).toMatch(/return caller === 'mcp:write'/)
  })

  it('handleToolsCall delegates the scope check to isToolGrantedToScope (single source of truth)', () => {
    expect(SOURCE).toMatch(/if \(!isToolGrantedToScope\(def\.scope, ctx\.scope\)\)/)
  })
})

describe('mcp http edge function — outputSchema parity (B3)', () => {
  it('ToolDef declares outputSchema as an optional Record', () => {
    expect(SOURCE).toMatch(/outputSchema\?: Record<string, unknown>/)
  })

  it('get_recent_reports declares an outputSchema with reports array + total', () => {
    expect(SOURCE).toMatch(/get_recent_reports:\s*\{[\s\S]*?outputSchema:\s*\{[\s\S]*?reports:[\s\S]*?total:/m)
  })

  it('search_reports declares an outputSchema with results array', () => {
    expect(SOURCE).toMatch(/search_reports:\s*\{[\s\S]*?outputSchema:\s*\{[\s\S]*?results:/m)
  })

  it('dispatch_fix declares an outputSchema with fixId + cursor agent fields', () => {
    expect(SOURCE).toMatch(/dispatch_fix:\s*\{[\s\S]*?outputSchema:\s*\{[\s\S]*?fixId:[\s\S]*?agentId:[\s\S]*?prUrl:/m)
  })

  it('handleToolsCall emits structuredContent when an outputSchema is defined', () => {
    expect(SOURCE).toMatch(/result\.structuredContent = data/)
  })

  it('handleToolsCall guards structuredContent on non-null object data only', () => {
    // Guard against accidentally sending structuredContent for a bare
    // string / number / null which would fail JSON-Schema validation
    // in modern MCP clients.
    expect(SOURCE).toMatch(/typeof data === 'object' && data !== null/)
  })

  it('tools/list output mapping includes outputSchema only when defined', () => {
    expect(SOURCE).toMatch(/\.\.\.\(def\.outputSchema \? \{ outputSchema: def\.outputSchema \} : \{\}\)/)
  })
})

describe('mcp http edge function — setup tools parity', () => {
  it('declares setup_check with dispatch preflight description', () => {
    expect(SOURCE).toMatch(/setup_check:\s*\{[\s\S]*?dispatch-readiness/m)
  })

  it('declares ingest_setup_check wired to /v1/sync/ingest-setup', () => {
    expect(SOURCE).toMatch(/ingest_setup_check:\s*\{[\s\S]*?\/v1\/sync\/ingest-setup/m)
  })

  it('setup_check handler requires or defaults projectId', () => {
    expect(SOURCE).toMatch(/setup_check:[\s\S]*?projectIdHint/m)
  })

  it('ingest_setup_check rejects JWT callers without projectIdHint', () => {
    expect(SOURCE).toMatch(/ingest_setup_check:[\s\S]*?!ctx\.projectIdHint[\s\S]*?ingest_setup_check requires API-key auth/m)
  })
})

describe('mcp http edge function — drift detector', () => {
  it('keeps the catalog comment that tells future agents to update both files', () => {
    expect(SOURCE).toMatch(/Mirror of `packages\/mcp\/src\/server\.ts`/)
  })

  it('keeps a comment block referencing MCP 2025-06-18 outputSchema spec', () => {
    expect(SOURCE).toMatch(/MCP 2025-06-18 outputSchema/)
  })
})
