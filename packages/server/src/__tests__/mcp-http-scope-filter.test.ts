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

/** The generated catalog copy the hosted server takes tool metadata from. */
const DISCOVERY = JSON.parse(
  readFileSync(resolve(__dirname, '../../supabase/functions/_shared/mcp-discovery-tools.json'), 'utf8'),
) as { tools: Record<string, { inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> }> }

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

  // Hosted schemas are no longer hand-declared next to each handler: every
  // tool takes its input and output schema from the generated catalog copy,
  // so the two transports cannot disagree (check-catalog-sync.mjs check 7).
  it('takes every hand-written tool\'s input and output schema from the catalog', () => {
    const overlay = SOURCE.split('function withCatalogMetadata')[1]?.split('\n}\n')[0] ?? ''
    expect(overlay).toMatch(/inputSchema: canonical\.inputSchema/)
    expect(overlay).toMatch(/outputSchema: canonical\.outputSchema/)
    expect(SOURCE).toMatch(/Object\.entries\(BASE_TOOLS\)\.map\(\(\[name, impl\]\) => \[name, withCatalogMetadata\(name, impl\)\]\)/)
  })

  it('get_recent_reports advertises the catalog outputSchema with reports array + total', () => {
    const out = DISCOVERY.tools.get_recent_reports?.outputSchema as { properties: Record<string, unknown>; required: string[] }
    expect(Object.keys(out.properties)).toEqual(expect.arrayContaining(['reports', 'total']))
    expect(out.required).toEqual(expect.arrayContaining(['reports', 'total']))
  })

  it('search_reports advertises the catalog outputSchema with a results array', () => {
    const out = DISCOVERY.tools.search_reports?.outputSchema as { properties: Record<string, { type?: string }> }
    expect(out.properties.results?.type).toBe('array')
  })

  it('dispatch_fix advertises { fixId, status } — the dispatch route returns nothing else', () => {
    const out = DISCOVERY.tools.dispatch_fix?.outputSchema as { properties: Record<string, unknown> }
    expect(Object.keys(out.properties).sort()).toEqual(['fixId', 'status'])
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

describe('mcp http edge function — one parameter spelling', () => {
  // Parameters are camelCase on both transports; the snake_case spelling is
  // an accepted alias (functions/mcp/arg-aliases.ts, identical to stdio's).
  it('renames aliases from the tool\'s declared schema before anything reads the arguments', () => {
    const call = SOURCE.split('async function handleToolsCall')[1]?.split('\nasync function ')[0] ?? ''
    const normalize = call.indexOf('const args = normalizeArgAliases(')
    expect(normalize).toBeGreaterThan(-1)
    expect(call.slice(normalize)).toMatch(/Object\.keys\(\(def\.inputSchema\.properties/)
    // The voice gate and the handler both see the normalized args.
    expect(call.indexOf('applyVoiceGate(args')).toBeGreaterThan(normalize)
    expect(call.indexOf('invokeToolAsResult(name, args')).toBeGreaterThan(normalize)
  })

  it('has no hosted handler reading a snake_case argument', () => {
    const base = SOURCE.split('const BASE_TOOLS')[1]?.split('/** Full catalog')[0] ?? ''
    expect(base.match(/\bargs\.[a-z]+_[a-z_]+/g) ?? []).toEqual([])
    const manifestTools = readFileSync(resolve(__dirname, '../../supabase/functions/mcp/manifest-tools.ts'), 'utf8')
    expect(manifestTools.match(/\bargs\.[a-z]+_[a-z_]+/g) ?? []).toEqual([])
    const manifest = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/mcp-hosted-tool-manifest.json'), 'utf8')
    // Templates name catalog parameters ({projectId}); wire keys stay snake_case.
    expect(manifest.match(/\{[a-z]+_[a-z_]+(\|[^}]*)?\}/g) ?? []).toEqual([])
  })

  it('advertises no snake_case parameter in any catalog tool', () => {
    const snake = Object.entries(DISCOVERY.tools).flatMap(([name, t]) =>
      Object.keys((t.inputSchema.properties ?? {}) as Record<string, unknown>)
        .filter((p) => p.includes('_'))
        .map((p) => `${name}.${p}`),
    )
    expect(snake).toEqual([])
  })
})

describe('mcp http edge function — setup tools parity', () => {
  // setup_check + ingest_setup_check were consolidated into the single
  // diagnose_setup entry point (mode=full|ingest|dispatch). Assert the
  // consolidated tool covers both readiness surfaces.
  it('advertises diagnose_setup with full|ingest|dispatch modes', () => {
    const mode = (DISCOVERY.tools.diagnose_setup?.inputSchema as { properties: Record<string, { enum?: string[] }> })
      .properties.mode
    expect(mode?.enum).toEqual(['full', 'ingest', 'dispatch'])
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
