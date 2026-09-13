/**
 * FILE: mcp-dual-era.test.ts
 * PURPOSE: Source-level contract test for the hosted MCP edge function
 *          (`supabase/functions/mcp/index.ts`) after the 2026-07-28
 *          attunement. The behavioural rules themselves are unit-tested in
 *          Deno (functions/mcp/protocol.test.ts, mrtr.test.ts,
 *          tasks.test.ts); this file asserts the edge function actually
 *          wires them — same pattern as mcp-http-scope-filter.test.ts,
 *          because the function imports Deno globals we cannot evaluate
 *          from Node.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const SOURCE = readFileSync(resolve(FUNCTIONS, 'mcp/index.ts'), 'utf8')
const PROTOCOL = readFileSync(resolve(FUNCTIONS, '_shared/mcp-protocol.ts'), 'utf8')

describe('mcp http edge function — protocol ladder', () => {
  it('supports all five published revisions, 2026-07-28 first', () => {
    expect(PROTOCOL).toMatch(/MODERN_PROTOCOL_VERSION = '2026-07-28'/)
    for (const v of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']) {
      expect(PROTOCOL).toContain(`'${v}'`)
    }
    expect(PROTOCOL).toMatch(/LEGACY_DEFAULT_PROTOCOL_VERSION: LegacyProtocolVersion = '2025-03-26'/)
  })

  it('no longer hard-codes the two-version list in the edge function', () => {
    expect(SOURCE).not.toMatch(/SUPPORTED_PROTOCOL_VERSIONS = \['2025-03-26', '2024-11-05'\]/)
    expect(SOURCE).toMatch(/negotiateLegacyVersion\(params\.protocolVersion\)/)
  })

  it('reads and validates MCP-Protocol-Version on POST (unknown ⇒ protocolErrorResponse)', () => {
    expect(SOURCE).toMatch(/resolveProtocolEra\(req\.headers\.get\('MCP-Protocol-Version'\)\)/)
    expect(SOURCE).toMatch(/if \(!eraResult\.ok\) return protocolErrorResponse\(eraResult\.error/)
  })

  it('rejects JSON-RPC batches for 2025-06-18+ and the modern era', () => {
    expect(SOURCE).toMatch(/Array\.isArray\(payload\) && !batchAllowed\(era\)/)
    expect(PROTOCOL).toMatch(/BATCH_CAPABLE_VERSIONS[^\n]*= \['2025-03-26', '2024-11-05'\]/)
  })

  it('never issues Mcp-Session-Id (the header comment now says so)', () => {
    expect(SOURCE).not.toMatch(/echo it back/)
    expect(SOURCE).toMatch(/NEVER issues or reads\s*\n\s*\*\s*`Mcp-Session-Id`/)
    expect(SOURCE).not.toMatch(/headers\[['"]Mcp-Session-Id['"]\]|'Mcp-Session-Id':/)
  })
})

describe('mcp http edge function — 2026-07-28 modern era', () => {
  it('branches to dispatchModernRpc and validates headers ⇄ body before auth', () => {
    expect(SOURCE).toMatch(/if \(ctx\.era\.era === 'modern'\) return dispatchModernRpc\(req, ctx\)/)
    expect(SOURCE).toMatch(/validateModernRequest\(req\.headers, probe, era\.version\)/)
    // Validation precedes resolveAuth in the POST path.
    expect(SOURCE.indexOf('validateModernRequest(req.headers')).toBeLessThan(
      SOURCE.indexOf('ctx = await resolveAuth(req, requestId, era, meta)'),
    )
  })

  it('implements server/discover and envelopes every result with resultType + serverInfo', () => {
    expect(SOURCE).toMatch(/case 'server\/discover':/)
    expect(SOURCE).toMatch(/buildServerDiscoverResult\(\{ serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS \}\)/)
    expect(SOURCE).toMatch(/result: withModernResultEnvelope\(result, SERVER_INFO\)/)
  })

  it('stamps ttlMs + cacheScope on tools/list, prompts/list, resources/list|read|templates/list', () => {
    expect(SOURCE).toMatch(/cacheable\(\s*handleToolsList\(ctx\),\s*TOOL_LIST_TTL_MS/)
    expect(SOURCE).toMatch(/cacheable\(handleResourcesList\(\), TOOL_LIST_TTL_MS, 'public'\)/)
    expect(SOURCE).toMatch(/cacheable\(\{ resourceTemplates: \[\] \}, TOOL_LIST_TTL_MS, 'public'\)/)
    expect(SOURCE).toMatch(/cacheable\(await handleResourcesRead\(params, ctx\), RESOURCE_READ_TTL_MS, 'private'\)/)
    expect(SOURCE).toMatch(/cacheable\(handlePromptsList\(\), TOOL_LIST_TTL_MS, 'public'\)/)
  })

  it('tools/list is deterministic (sorted by name) for modern clients', () => {
    expect(SOURCE).toMatch(/ctx\.era\.era === 'modern' \? sortByName\(tools\) : tools/)
  })

  it('answers 405 to GET and DELETE when the header is 2026-07-28', () => {
    expect(SOURCE).toMatch(/if \(isModernRequest\(req\)\) return modernMethodNotAllowed\(\)/)
    expect((SOURCE.match(/if \(isModernRequest\(req\)\) return modernMethodNotAllowed\(\)/g) ?? []).length).toBe(2)
    expect(SOURCE).toMatch(/status: 405,\s*\n\s*headers: \{ 'Content-Type': 'application\/json', Allow: MODERN_ALLOWED_METHODS/)
  })

  it('removed methods (initialize, ping, …) answer -32601 in the modern dispatcher', () => {
    expect(SOURCE).toMatch(/MODERN_REMOVED_METHODS\.has\(req\.method\)/)
    expect(SOURCE).toMatch(/was removed in MCP 2026-07-28/)
  })

  it('continues the inbound W3C trace (SEP-414) instead of minting a new one', () => {
    expect(SOURCE).toMatch(/const trace = readTraceMeta\(rpc\.params\)/)
    expect(SOURCE).toMatch(/attachTraceparent\(ctx\.authHeaders, childTraceparent\(trace\.traceparent\)\)/)
    expect(SOURCE).toMatch(/Sentry\.continueTrace\(\{ sentryTrace, baggage/)
  })
})

describe('mcp http edge function — tasks extension + MRTR voice gate', () => {
  it('gates tasks/* on the declared io.modelcontextprotocol/tasks capability (-32021 otherwise)', () => {
    expect(SOURCE).toMatch(/case 'tasks\/get':\s*\n\s*case 'tasks\/update':\s*\n\s*case 'tasks\/cancel':/)
    expect(SOURCE).toMatch(/if \(!ctx\.meta\?\.declaresTasks\) \{\s*\n\s*throw new McpError\(\s*\n\s*ERR_MISSING_CLIENT_CAPABILITY/)
  })

  it('returns dispatch_fix as a task only to declaring clients, after the job row exists', () => {
    expect(SOURCE).toMatch(/isDispatchFixTool\(name\) && ctx\.meta\?\.declaresTasks && !result\.isError/)
    expect(SOURCE).toMatch(/if \(job\) return createTaskResultForJob\(job\)/)
  })

  it('runs the voice confirmation gate before dispatching and outside the tool-error try block', () => {
    expect(SOURCE).toMatch(/const gated = await applyVoiceGate\(args, params, ctx\)/)
    expect(SOURCE.indexOf('const gated = await applyVoiceGate')).toBeLessThan(
      SOURCE.indexOf('const result = await invokeToolAsResult(name, args, ctx, recordOutcome)'),
    )
    expect(SOURCE).toMatch(/evaluateVoiceGate\(\{/)
    expect(SOURCE).toMatch(/if \(ctx\.era\.era !== 'modern'\) return legacyVoiceGateResult\(session, reportId\)/)
  })

  it('signs requestState with the internal caller secret (service-role fallback)', () => {
    expect(SOURCE).toMatch(/resolveRequestStateSecret\(Deno\.env\)/)
    const mrtr = readFileSync(resolve(FUNCTIONS, '_shared/mcp-mrtr.ts'), 'utf8')
    expect(mrtr).toMatch(/MUSHI_INTERNAL_CALLER_SECRET/)
    expect(mrtr).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(mrtr).toMatch(/REQUEST_STATE_TTL_MS = 10 \* 60_000/)
    expect(mrtr).toMatch(/crypto\.subtle\.verify\('HMAC'/)
  })
})

describe('mcp http edge function — dispatch_fix agent input', () => {
  it('declares the agent enum and forwards it to the dispatch route body', () => {
    expect(SOURCE).toMatch(
      /agent: \{\s*\n\s*type: 'string',\s*\n\s*enum: \['claude_code', 'codex', 'auto', 'rest_fix_worker', 'llm', 'mcp', 'cursor_cloud', 'github_cloud_agent'\]/,
    )
    expect(SOURCE).toMatch(/\.\.\.\(typeof args\.agent === 'string' && args\.agent \? \{ agent: args\.agent \} : \{\}\)/)
  })
})
