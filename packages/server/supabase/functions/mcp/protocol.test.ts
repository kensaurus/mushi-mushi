/**
 * FILE: packages/server/supabase/functions/mcp/protocol.test.ts
 * PURPOSE: Dual-era protocol rules for the hosted MCP endpoint
 *          (_shared/mcp-protocol.ts): version negotiation across all five
 *          revisions, MCP-Protocol-Version header validation, batch policy,
 *          server/discover shape, Mcp-Method / Mcp-Name mismatch ⇒ -32020,
 *          and the cacheable / resultType envelopes.
 *
 * Lives under mcp/ (not _shared/) because the deno-check workflow only runs
 * `*.test.ts` outside _shared, with no --allow-* flags — everything here is
 * pure.
 */

import { assert, assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  BATCH_CAPABLE_VERSIONS,
  ERR_HEADER_MISMATCH,
  ERR_UNSUPPORTED_PROTOCOL_VERSION,
  LEGACY_DEFAULT_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSIONS,
  META_CLIENT_CAPABILITIES,
  META_CLIENT_INFO,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  MODERN_PROTOCOL_VERSION,
  MODERN_REMOVED_METHODS,
  SUPPORTED_PROTOCOL_VERSIONS,
  TASKS_EXTENSION_ID,
  TOOL_LIST_TTL_MS,
  batchAllowed,
  batchRejectedError,
  buildServerDiscoverResult,
  cacheable,
  decodeMcpName,
  encodeMcpName,
  negotiateLegacyVersion,
  readModernMeta,
  resolveProtocolEra,
  sentryTraceFromTraceparent,
  sortByName,
  validateModernRequest,
  withModernResultEnvelope,
  type ProtocolEra,
} from '../_shared/mcp-protocol.ts'

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name) => lower.get(name.toLowerCase()) ?? null }
}

function modernParams(extra: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  return {
    ...extra,
    _meta: {
      [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION,
      [META_CLIENT_CAPABILITIES]: {},
      [META_CLIENT_INFO]: { name: 'test-client', version: '1.0.0' },
      ...meta,
    },
  }
}

// ── Ladder ───────────────────────────────────────────────────────────────────

Deno.test('ladder: all five published revisions are supported, newest first', () => {
  assertEquals([...SUPPORTED_PROTOCOL_VERSIONS], [
    '2026-07-28',
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05',
  ])
  assertEquals(MODERN_PROTOCOL_VERSION, '2026-07-28')
  assertEquals(LEGACY_DEFAULT_PROTOCOL_VERSION, '2025-03-26')
})

Deno.test('legacy initialize: each legacy version negotiates to itself', () => {
  for (const v of LEGACY_PROTOCOL_VERSIONS) {
    assertEquals(negotiateLegacyVersion(v), v)
  }
})

Deno.test('legacy initialize: missing protocolVersion keeps the 2025-03-26 default', () => {
  assertEquals(negotiateLegacyVersion(undefined), '2025-03-26')
  assertEquals(negotiateLegacyVersion(''), '2025-03-26')
  assertEquals(negotiateLegacyVersion(42), '2025-03-26')
})

Deno.test('legacy initialize: unknown (or modern) version falls to the newest legacy version', () => {
  assertEquals(negotiateLegacyVersion('2023-01-01'), '2025-11-25')
  assertEquals(negotiateLegacyVersion('2026-07-28'), '2025-11-25')
})

// ── Header → era ─────────────────────────────────────────────────────────────

Deno.test('header: missing ⇒ legacy 2025-03-26 (spec default), headerPresent=false', () => {
  const r = resolveProtocolEra(null)
  assert(r.ok)
  assertEquals(r.era, { era: 'legacy', version: '2025-03-26', headerPresent: false })
  const blank = resolveProtocolEra('   ')
  assert(blank.ok && blank.era.era === 'legacy' && !blank.era.headerPresent)
})

Deno.test('header: every legacy value resolves to the legacy era with that version', () => {
  for (const v of LEGACY_PROTOCOL_VERSIONS) {
    const r = resolveProtocolEra(v)
    assert(r.ok)
    assertEquals(r.era, { era: 'legacy', version: v, headerPresent: true })
  }
})

Deno.test('header: 2026-07-28 ⇒ modern era', () => {
  const r = resolveProtocolEra(' 2026-07-28 ')
  assert(r.ok)
  assertEquals(r.era, { era: 'modern', version: '2026-07-28' })
})

Deno.test('header: unknown value ⇒ 400 / -32022 with the supported list in error.data', () => {
  const r = resolveProtocolEra('2027-01-01')
  assert(!r.ok)
  assertEquals(r.error.code, ERR_UNSUPPORTED_PROTOCOL_VERSION)
  assertEquals(r.error.httpStatus, 400)
  const data = r.error.data as { supportedVersions: string[]; received: string }
  assertEquals(data.supportedVersions, [...SUPPORTED_PROTOCOL_VERSIONS])
  assertEquals(data.received, '2027-01-01')
})

// ── Batch policy ─────────────────────────────────────────────────────────────

Deno.test('batch: allowed only for 2024-11-05 and 2025-03-26 (including the header-less default)', () => {
  assertEquals([...BATCH_CAPABLE_VERSIONS], ['2025-03-26', '2024-11-05'])
  const legacy = (version: ProtocolEra & { era: 'legacy' } extends never ? never : string, headerPresent = true): ProtocolEra =>
    ({ era: 'legacy', version: version as '2025-03-26', headerPresent })
  assert(batchAllowed(legacy('2024-11-05')))
  assert(batchAllowed(legacy('2025-03-26')))
  assert(batchAllowed(legacy('2025-03-26', false)))
  assert(!batchAllowed(legacy('2025-06-18')))
  assert(!batchAllowed(legacy('2025-11-25')))
  assert(!batchAllowed({ era: 'modern', version: '2026-07-28' }))
})

Deno.test('batch: rejection is 400 / -32600 and names the version', () => {
  const err = batchRejectedError({ era: 'legacy', version: '2025-06-18', headerPresent: true })
  assertEquals(err.code, -32600)
  assertEquals(err.httpStatus, 400)
  assert(err.message.includes('2025-06-18'))
})

// ── Mcp-Name encoding ────────────────────────────────────────────────────────

Deno.test('Mcp-Name: printable ASCII passes through, anything else uses the base64 sentinel', () => {
  assertEquals(encodeMcpName('dispatch_fix'), 'dispatch_fix')
  assertEquals(encodeMcpName('project://dashboard'), 'project://dashboard')
  const encoded = encodeMcpName('虫を直す')
  assert(encoded.startsWith('=?base64?') && encoded.endsWith('?='))
  assertEquals(decodeMcpName(encoded), '虫を直す')
  assertEquals(decodeMcpName('dispatch_fix'), 'dispatch_fix')
  assertEquals(decodeMcpName('=?base64?!!!not-base64!!!?='), null)
})

// ── Modern request validation ────────────────────────────────────────────────

Deno.test('modern: a consistent tools/call passes validation', () => {
  const fault = validateModernRequest(
    headers({ 'Mcp-Method': 'tools/call', 'Mcp-Name': 'dispatch_fix' }),
    { method: 'tools/call', params: modernParams({ name: 'dispatch_fix' }) },
    MODERN_PROTOCOL_VERSION,
  )
  assertStrictEquals(fault, null)
})

Deno.test('modern: missing _meta protocolVersion ⇒ -32020', () => {
  const fault = validateModernRequest(
    headers({ 'Mcp-Method': 'tools/list' }),
    { method: 'tools/list', params: {} },
    MODERN_PROTOCOL_VERSION,
  )
  assert(fault)
  assertEquals(fault.code, ERR_HEADER_MISMATCH)
  assertEquals(fault.httpStatus, 400)
})

Deno.test('modern: _meta protocolVersion ≠ header ⇒ -32020', () => {
  const fault = validateModernRequest(
    headers({ 'Mcp-Method': 'tools/list' }),
    { method: 'tools/list', params: modernParams({}, { [META_PROTOCOL_VERSION]: '2025-11-25' }) },
    MODERN_PROTOCOL_VERSION,
  )
  assert(fault)
  assertEquals(fault.code, ERR_HEADER_MISMATCH)
  assertEquals(fault.data, { header: '2026-07-28', meta: '2025-11-25' })
})

Deno.test('modern: Mcp-Method missing or different from the body ⇒ -32020', () => {
  const missing = validateModernRequest(headers({}), { method: 'tools/list', params: modernParams() }, MODERN_PROTOCOL_VERSION)
  assert(missing && missing.code === ERR_HEADER_MISMATCH)
  const wrong = validateModernRequest(
    headers({ 'Mcp-Method': 'prompts/list' }),
    { method: 'tools/list', params: modernParams() },
    MODERN_PROTOCOL_VERSION,
  )
  assert(wrong && wrong.code === ERR_HEADER_MISMATCH)
  assertEquals(wrong.data, { header: 'prompts/list', body: 'tools/list' })
})

Deno.test('modern: Mcp-Name is required for tools/call, resources/read, prompts/get and must match', () => {
  const noName = validateModernRequest(
    headers({ 'Mcp-Method': 'resources/read' }),
    { method: 'resources/read', params: modernParams({ uri: 'project://stats' }) },
    MODERN_PROTOCOL_VERSION,
  )
  assert(noName && noName.code === ERR_HEADER_MISMATCH)

  const mismatch = validateModernRequest(
    headers({ 'Mcp-Method': 'prompts/get', 'Mcp-Name': 'triage_next_steps' }),
    { method: 'prompts/get', params: modernParams({ name: 'explain_judge_result' }) },
    MODERN_PROTOCOL_VERSION,
  )
  assert(mismatch && mismatch.code === ERR_HEADER_MISMATCH)

  const encodedOk = validateModernRequest(
    headers({ 'Mcp-Method': 'tools/call', 'Mcp-Name': encodeMcpName('虫') }),
    { method: 'tools/call', params: modernParams({ name: '虫' }) },
    MODERN_PROTOCOL_VERSION,
  )
  assertStrictEquals(encodedOk, null)

  // Methods without a name never need the header.
  const listOk = validateModernRequest(
    headers({ 'Mcp-Method': 'tools/list' }),
    { method: 'tools/list', params: modernParams() },
    MODERN_PROTOCOL_VERSION,
  )
  assertStrictEquals(listOk, null)
})

Deno.test('modern: removed methods are enumerated (initialize, ping, logging, roots/elicitation notifications, subscribe)', () => {
  for (const m of [
    'initialize',
    'notifications/initialized',
    'ping',
    'logging/setLevel',
    'notifications/roots/list_changed',
    'notifications/elicitation/complete',
    'resources/subscribe',
  ]) {
    assert(MODERN_REMOVED_METHODS.has(m), m)
  }
  assert(!MODERN_REMOVED_METHODS.has('server/discover'))
  assert(!MODERN_REMOVED_METHODS.has('tools/call'))
})

// ── _meta reading ────────────────────────────────────────────────────────────

Deno.test('readModernMeta: tasks extension declaration + trace context', () => {
  const m = readModernMeta(
    modernParams(
      {},
      {
        [META_CLIENT_CAPABILITIES]: { extensions: { [TASKS_EXTENSION_ID]: {} } },
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        tracestate: 'vendor=1',
        baggage: 'k=v',
      },
    ),
  )
  assertEquals(m.protocolVersion, '2026-07-28')
  assert(m.declaresTasks)
  assertEquals(m.clientInfo, { name: 'test-client', version: '1.0.0' })
  assertEquals(m.traceparent, '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
  assertEquals(m.tracestate, 'vendor=1')
  assertEquals(m.baggage, 'k=v')
})

Deno.test('readModernMeta: no declaration ⇒ declaresTasks=false; malformed traceparent dropped', () => {
  const m = readModernMeta(modernParams({}, { traceparent: 'garbage' }))
  assert(!m.declaresTasks)
  assertStrictEquals(m.traceparent, null)
  const none = readModernMeta(undefined)
  assertStrictEquals(none.protocolVersion, null)
  assert(!none.declaresTasks)
})

Deno.test('sentryTraceFromTraceparent: keeps trace/span ids and maps the sampled flag', () => {
  assertEquals(
    sentryTraceFromTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'),
    '0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-1',
  )
  assertEquals(
    sentryTraceFromTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00'),
    '0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-0',
  )
  assertStrictEquals(sentryTraceFromTraceparent('nope'), null)
})

// ── server/discover + envelopes ──────────────────────────────────────────────

Deno.test('server/discover: complete, all five versions, tasks extension, ttl/cacheScope, serverInfo in _meta', () => {
  const r = buildServerDiscoverResult({
    serverInfo: { name: 'mushi-mushi', version: '2.0.0', title: 'Mushi Mushi' },
    instructions: 'hello',
  })
  assertEquals(r.resultType, 'complete')
  assertEquals(r.supportedVersions, [...SUPPORTED_PROTOCOL_VERSIONS])
  assertEquals(r.capabilities.tools, {})
  assertEquals(r.capabilities.resources, {})
  assertEquals(r.capabilities.prompts, {})
  assertEquals(r.capabilities.extensions, { [TASKS_EXTENSION_ID]: {} })
  assertEquals(r.instructions, 'hello')
  assertEquals(typeof r.ttlMs, 'number')
  assertEquals(r.cacheScope, 'public')
  assertEquals(r._meta[META_SERVER_INFO], { name: 'mushi-mushi', version: '2.0.0', title: 'Mushi Mushi' })
})

Deno.test('cacheable: stamps ttlMs + cacheScope onto a list result', () => {
  const r = cacheable({ tools: [] }, TOOL_LIST_TTL_MS, 'public')
  assertEquals(r, { tools: [], ttlMs: 3_600_000, cacheScope: 'public' })
})

Deno.test('withModernResultEnvelope: defaults resultType to complete and adds serverInfo; keeps input_required / task', () => {
  const info = { name: 'mushi-mushi', version: '2.0.0' }
  const plain = withModernResultEnvelope({ content: [] }, info)
  assertEquals(plain.resultType, 'complete')
  assertEquals((plain._meta as Record<string, unknown>)[META_SERVER_INFO], info)

  const ir = withModernResultEnvelope({ resultType: 'input_required', inputRequests: {}, requestState: 'x' }, info)
  assertEquals(ir.resultType, 'input_required')
  const task = withModernResultEnvelope({ resultType: 'task', taskId: 't' }, info)
  assertEquals(task.resultType, 'task')
})

Deno.test('sortByName: deterministic tools/list order', () => {
  const sorted = sortByName([{ name: 'zeta' }, { name: 'alpha' }, { name: 'mid' }])
  assertEquals(sorted.map((t) => t.name), ['alpha', 'mid', 'zeta'])
})
