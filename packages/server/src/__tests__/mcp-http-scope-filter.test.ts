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
    // The call path resolves the caller's scope via effectiveScope(ctx) so a
    // read_only-mode mcp:write key is correctly downgraded to read before the
    // grant check. Assert the guard runs against that resolved scope, not the
    // raw ctx.scope.
    expect(SOURCE).toMatch(/const callerScope = effectiveScope\(ctx\)/)
    expect(SOURCE).toMatch(/if \(!isToolGrantedToScope\(def\.scope, callerScope\)\)/)
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
  // setup_check + ingest_setup_check were consolidated into the single
  // diagnose_setup entry point (mode=full|ingest|dispatch). Assert the
  // consolidated tool covers both readiness surfaces.
  it('declares diagnose_setup with full|ingest|dispatch modes', () => {
    expect(SOURCE).toMatch(/diagnose_setup:\s*\{[\s\S]*?enum:\s*\['full',\s*'ingest',\s*'dispatch'\]/m)
  })

  it('diagnose_setup ingest mode is wired to /v1/sync/ingest-setup', () => {
    expect(SOURCE).toMatch(/diagnose_setup:\s*\{[\s\S]*?\/v1\/sync\/ingest-setup/m)
  })

  it('diagnose_setup dispatch mode hits the project preflight endpoint', () => {
    expect(SOURCE).toMatch(/diagnose_setup:\s*\{[\s\S]*?\/preflight/m)
  })

  it('diagnose_setup resolves projectId from args or the API-key project hint', () => {
    expect(SOURCE).toMatch(/diagnose_setup:[\s\S]*?ctx\.projectIdHint/m)
  })
})

describe('mcp http edge function — tool-execution error shape (production-readiness audit #13)', () => {
  // Tool EXECUTION failures (bad args a handler rejected, a downstream
  // /v1/admin/* 4xx/5xx via apiCall) must surface as a successful tools/call
  // result with isError: true — not a re-thrown top-level JSON-RPC error —
  // so the calling LLM can see the message and self-correct. Stdio gets
  // this for free from the official MCP SDK's registerTool; the hosted
  // transport's hand-rolled dispatcher has to do it explicitly.
  it('handleToolsCall catch block returns isError: true instead of re-throwing', () => {
    expect(SOURCE).toMatch(/content: \[\{ type: 'text', text: JSON\.stringify\(errorPayload, null, 2\) \}\],\s*\n\s*isError: true,/);
  });

  it('handleToolsCall catch block no longer re-throws the caught error', () => {
    const catchBlockMatch = SOURCE.match(/recordOutcome\('error', errorCode\)[\s\S]*?\n  \}\n\}/m);
    expect(catchBlockMatch).not.toBeNull();
    expect(catchBlockMatch![0]).not.toMatch(/\n\s*throw err\s*\n/);
  });

  it('preserves McpError code + data in the isError payload for structured debugging', () => {
    expect(SOURCE).toMatch(/errorPayload\.code = err\.code/);
    expect(SOURCE).toMatch(/errorPayload\.data = err\.data/);
  });
});

describe('mcp http edge function — drift detector', () => {
  it('keeps the catalog comment that tells future agents to update both files', () => {
    expect(SOURCE).toMatch(/Mirror of `packages\/mcp\/src\/server\.ts`/)
  })

  it('keeps a comment block referencing MCP 2025-06-18 outputSchema spec', () => {
    expect(SOURCE).toMatch(/MCP 2025-06-18 outputSchema/)
  })
})
