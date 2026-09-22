/**
 * FILE: packages/mcp/src/__tests__/report-shapes.test.ts
 * PURPOSE: What the report tools hand an agent (report-shapes.ts, shared
 *          byte-for-byte with the hosted server).
 *   - get_report_detail returned the raw detail row, typed z.unknown(): every
 *     column including end_user_id, session_id and the joined end_users row.
 *     It now returns documented fields under a typed outputSchema, with
 *     includeRaw as the escape hatch (reporter identifiers removed either way).
 *   - get_report_evidence returned the reporter's session_id.
 *   - triage_issue returned z.unknown() fields and read the OLDEST fix attempt
 *     as "the last one" (the route orders newest first), and pointed
 *     get_fix_timeline at a report id.
 *   - merge_fix and generate_tdd_from_story declared output schemas without
 *     fields their routes return, so strict clients rejected a merge or a
 *     generated test PR that had already happened.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'
import { projectReportDetail, reportEvidenceOf, triageRecommendedActions } from '../report-shapes.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const REPORT_ID = '33333333-3333-4333-8333-333333333333'

/** A detail-route row as GET /v1/admin/reports/:id returns it (trimmed). */
const DETAIL_ROW = {
  id: REPORT_ID,
  project_id: PROJECT_ID,
  title: 'Pay button dead',
  summary: 'Checkout pay button does nothing',
  description: 'I click pay and nothing happens',
  status: 'fixing',
  category: 'bug',
  severity: 'high',
  component: 'Checkout',
  created_at: '2026-09-20T00:00:00Z',
  screenshot_url: 'https://cdn.example/s.png',
  console_logs: [{ level: 'error', message: 'TypeError' }],
  network_logs: [],
  stage2_analysis: { rootCause: 'handler unbound' },
  reproduction_steps: ['open checkout', 'click pay'],
  fix_attempts: [
    { id: 'fix-newest', status: 'running' },
    { id: 'fix-oldest', status: 'failed' },
  ],
  fix_packet: 'Paste this into your agent',
  inventory_action: { actionNodeId: 'node-1' },
  backend_spans: [{ id: 'span-1', trace_id: 't1', session_id: 'sess-in-span', span_json: {} }],
  // Internal columns, only with includeRaw.
  custom_metadata: { traceparent: '00-abc-def-01' },
  llm_invocations: [{ id: 'llm-1' }],
  screenshot_path: 'storage://supabase/bucket/key',
  // Reporter identity — never returned.
  end_user_id: 'eu-1',
  reporter_token_hash: 'hash-1',
  session_id: 'sess-1',
  reporter_display_name: 'Jane Doe',
  reporter_user_id: 'host-user-7',
  reporter_identity: { display_name: 'Jane Doe', external_user_id: 'host-user-7' },
  tester_id: 'tester-1',
}

function stubFetch(routes: Record<string, unknown>) {
  const urls: string[] = []
  const headers: Array<Record<string, string>> = []
  const stub = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    const h: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers as Record<string, string> | undefined) ?? {})) h[k.toLowerCase()] = v
    headers.push(h)
    const path = url.slice(API_ENDPOINT.length)
    const key = Object.keys(routes).find((k) => path === k || path.startsWith(`${k}?`))
    if (!key) return new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: path } }), { status: 404 })
    return new Response(JSON.stringify({ ok: true, data: routes[key] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { stub, urls, headers }
}

let client: Client | null = null
afterEach(async () => {
  await client?.close()
  client = null
})

/** projectId null = account mode (no MUSHI_PROJECT_ID). */
async function connect(stub: typeof fetch, projectId: string | null = PROJECT_ID): Promise<Client> {
  const server = createMushiServer({
    version: '0.0.0-test',
    apiEndpoint: API_ENDPOINT,
    apiKey: 'mushi_test_key_0123456789', // gitleaks:allow
    ...(projectId ? { projectId } : {}),
    fetch: stub,
    features: 'all',
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: 'report-shapes-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)])
  // The client validates structuredContent against each tool's outputSchema
  // once it has listed the tools, so a shape mismatch fails the call.
  await c.listTools()
  client = c
  return c
}

/** Everything in DETAIL_ROW that identifies the reporter. */
const identityKeys = [
  'end_user_id',
  'reporter_token_hash',
  'session_id',
  'reporter_display_name',
  'reporter_user_id',
  'reporter_identity',
  'tester_id',
]

describe('projectReportDetail', () => {
  it('returns documented fields only, without reporter identifiers or span sessions', () => {
    const out = projectReportDetail(DETAIL_ROW, false)
    expect(out).toMatchObject({ id: REPORT_ID, summary: DETAIL_ROW.summary, fix_packet: 'Paste this into your agent' })
    for (const key of [...identityKeys, 'custom_metadata', 'llm_invocations', 'screenshot_path']) {
      expect(out, key).not.toHaveProperty(key)
    }
    expect(out.backend_spans).toEqual([{ id: 'span-1', trace_id: 't1', span_json: {} }])
  })

  it('includeRaw adds the internal columns but still drops reporter identifiers', () => {
    const out = projectReportDetail(DETAIL_ROW, true)
    expect(out).toHaveProperty('custom_metadata')
    expect(out).toHaveProperty('llm_invocations')
    for (const key of identityKeys) expect(out, key).not.toHaveProperty(key)
  })
})

describe('reportEvidenceOf', () => {
  it('carries the evidence but no session id', () => {
    const evidence = reportEvidenceOf(DETAIL_ROW, REPORT_ID)
    expect(evidence).toMatchObject({ report_id: REPORT_ID, console_logs: DETAIL_ROW.console_logs })
    expect(evidence).not.toHaveProperty('session_id')
    expect(JSON.stringify(evidence)).not.toContain('sess-')
  })
})

describe('triageRecommendedActions', () => {
  it('points at the newest fix attempt (the route orders newest first) by fixId', () => {
    const actions = triageRecommendedActions({ ...DETAIL_ROW, processing_error: null }, REPORT_ID)
    expect(actions[0]).toMatchObject({ tool: 'get_fix_timeline', args: { fixId: 'fix-newest' } })
  })

  it('treats a failed NEWEST attempt as blocked, and ignores an old failure', () => {
    const blocked = triageRecommendedActions(
      { ...DETAIL_ROW, status: 'classified', fix_attempts: [{ id: 'f2', status: 'failed' }, { id: 'f1', status: 'completed' }] },
      REPORT_ID,
    )
    expect(blocked.map((a) => a.action)).toEqual(['unblock_autofix', 'redispatch_after_unblock', 'check_blast_radius'])
    const recovered = triageRecommendedActions(
      { ...DETAIL_ROW, status: 'classified', fix_attempts: [{ id: 'f2', status: 'completed' }, { id: 'f1', status: 'failed' }] },
      REPORT_ID,
    )
    expect(recovered[0]).toMatchObject({ tool: 'dispatch_fix', args: { reportId: REPORT_ID } })
  })

  it('suggests the blast radius of the inventory action for high severity', () => {
    const actions = triageRecommendedActions(DETAIL_ROW, REPORT_ID)
    expect(actions).toContainEqual(expect.objectContaining({ tool: 'get_blast_radius', args: { nodeId: 'node-1' } }))
  })
})

describe('report tools over MCP', () => {
  const routes = {
    [`/v1/admin/reports/${REPORT_ID}`]: DETAIL_ROW,
    [`/v1/admin/reports/${REPORT_ID}/timeline`]: { report_id: REPORT_ID, timeline: [] },
    '/v1/admin/reports/similarity': { results: [{ reportId: 'other', similarity: 0.8, description: 'd', category: 'bug', createdAt: null, reportGroupId: null }] },
    '/v1/admin/graph/blast-radius/node-1': { affected: [] },
    [`/v1/admin/mcp/logs/${PROJECT_ID}`]: { project_id: PROJECT_ID, entries: [] },
  }

  it('get_report_detail advertises a typed report and returns the projection', async () => {
    const c = await connect(stubFetch(routes).stub)
    const { tools } = await c.listTools()
    const out = tools.find((t) => t.name === 'get_report_detail')!.outputSchema!
    const report = (out.properties as Record<string, { properties?: Record<string, unknown> }>).report
    expect(Object.keys(report?.properties ?? {})).toEqual(expect.arrayContaining(['id', 'summary', 'status', 'severity', 'fix_attempts']))
    const res = await c.callTool({ name: 'get_report_detail', arguments: { reportId: REPORT_ID } })
    const got = (res.structuredContent as { report: Record<string, unknown> }).report
    expect(got.id).toBe(REPORT_ID)
    for (const key of identityKeys) expect(got, key).not.toHaveProperty(key)
    expect(got).not.toHaveProperty('custom_metadata')
    const raw = await c.callTool({ name: 'get_report_detail', arguments: { reportId: REPORT_ID, include_raw: true } })
    expect((raw.structuredContent as { report: Record<string, unknown> }).report).toHaveProperty('custom_metadata')
  })

  it('get_report_evidence drops the reporter session id', async () => {
    const c = await connect(stubFetch(routes).stub)
    const res = await c.callTool({ name: 'get_report_evidence', arguments: { reportId: REPORT_ID } })
    const text = (res.content as Array<{ text: string }>)[0]!.text
    expect(text).not.toContain('sess-1')
    expect(text).not.toContain('session_id')
  })

  it('triage_issue returns a packet that satisfies its typed outputSchema', async () => {
    const c = await connect(stubFetch(routes).stub)
    const res = await c.callTool({ name: 'triage_issue', arguments: { report_id: REPORT_ID } })
    expect(res.isError).toBeFalsy()
    const packet = res.structuredContent as Record<string, unknown>
    expect(packet.severity).toBe('high')
    expect(packet.partial_errors).toEqual([])
    expect((packet.similar_bugs as Array<{ reportId: string }>).map((s) => s.reportId)).toEqual(['other'])
    for (const key of identityKeys) expect(packet.report as Record<string, unknown>, key).not.toHaveProperty(key)
    const actions = packet.recommended_actions as Array<{ args?: Record<string, unknown> }>
    for (const a of actions) for (const k of Object.keys(a.args ?? {})) expect(k).not.toContain('_')
  })

  it('merge_fix accepts every field the merge route returns', async () => {
    const c = await connect(
      stubFetch({
        '/v1/admin/fixes/fix-1/merge': { merged: true, alreadyMerged: false, justMerged: true, reportId: REPORT_ID, reportStatus: 'fixed', sha: 'abc123' },
      }).stub,
    )
    const res = await c.callTool({ name: 'merge_fix', arguments: { fixId: 'fix-1' } })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ merged: true, justMerged: true, sha: 'abc123' })
  })

  it('generate_tdd_from_story accepts every field test-gen-from-story returns', async () => {
    const c = await connect(
      stubFetch({
        [`/v1/admin/inventory/${PROJECT_ID}/stories/story-1/generate-test`]: {
          qaStoryId: 'qa-1',
          prUrl: null,
          approvalStatus: 'pending_review',
          needsHumanReview: true,
          path: 'e2e/story-1.spec.ts',
          firecrawlActionsYaml: null,
        },
      }).stub,
    )
    const res = await c.callTool({ name: 'generate_tdd_from_story', arguments: { projectId: PROJECT_ID, storyNodeId: 'story-1' } })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ qaStoryId: 'qa-1', path: 'e2e/story-1.spec.ts' })
  })

  it('get_usage scopes by header (the route ignores ?project_id=) and returns structured content', async () => {
    const fetchLog = stubFetch({
      '/v1/admin/billing/stats': { projectId: PROJECT_ID, planId: 'hobby', diagnosesUsed: 3, reportsUsed: 12 },
    })
    // Account mode, so the header can only come from the argument.
    const c = await connect(fetchLog.stub, null)
    const res = await c.callTool({ name: 'get_usage', arguments: { project_id: PROJECT_ID } })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ planId: 'hobby', diagnosesUsed: 3, reportsUsed: 12 })
    expect(fetchLog.urls.at(-1)).toBe(`${API_ENDPOINT}/v1/admin/billing/stats`)
    expect(fetchLog.headers.at(-1)?.['x-mushi-project-id']).toBe(PROJECT_ID)
  })
})
