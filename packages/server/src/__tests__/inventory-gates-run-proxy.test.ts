/**
 * Mushi report 67f40c20: POST /v1/admin/inventory/:id/gates/run dropped the
 * CI evidence (lint findings, discovered APIs, oasdiff findings) before
 * calling inventory-gates, and nested the gate results one level too deep,
 * so mcp-ci read no runs and its gates always passed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { gateEvidenceFromBody } from '../../supabase/functions/_shared/gate-evidence.ts'

const P = '1000000b-0000-4000-8000-000000000000'
let db: FakeDb

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1')
    c.set('authMethod', 'apiKey')
    c.set('projectId', P)
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

const DEAD_HANDLER = {
  gate: 'dead_handler',
  severity: 'error',
  rule_id: 'mushi-mushi/no-dead-handler',
  message: 'Empty onClick handler',
  file_path: 'src/Checkout.tsx',
  line: 3,
  col: 11,
}

let app: Hono
let forwarded: Record<string, unknown> | null
let gatesAnswer: { status: number; body: unknown }

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as Record<string, string>)[k] },
  }
  const { registerInventoryRoutes } = await import('../../supabase/functions/api/routes/inventory.ts')
  app = new Hono()
  registerInventoryRoutes(app as never)
})

beforeEach(() => {
  db = makeFakeDb({
    projects: [{ id: P, owner_id: 'user-1', organization_id: null }],
    organization_members: [],
    project_members: [],
  })
  forwarded = null
  gatesAnswer = {
    status: 200,
    body: { ok: true, data: { runs: [{ gate: 'dead_handler', status: 'fail', findings_count: 1, run_id: 'r1' }], overall: 'fail' } },
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/functions/v1/inventory-gates')) {
      forwarded = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify(gatesAnswer.body), { status: gatesAnswer.status })
    }
    throw new Error(`unexpected fetch ${String(input)}`)
  })
})

afterEach(() => vi.restoreAllMocks())

async function run(body: unknown) {
  const res = await app.request(`/v1/admin/inventory/${P}/gates/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: { runs?: unknown[]; overall?: string }; error?: { code: string } } }
}

describe('POST /v1/admin/inventory/:projectId/gates/run', () => {
  it('forwards lint findings, discovered APIs and oasdiff findings to inventory-gates', async () => {
    const spec = { severity: 'error', message: 'removed GET /v1/a', path: '/v1/a', method: 'GET' }
    const res = await run({
      gates: ['dead_handler', 'api_contract', 'spec_drift'],
      findings: [DEAD_HANDLER],
      discovered_apis: ['GET /v1/a'],
      spec_diff_findings: [spec],
    })
    expect(res.status).toBe(200)
    expect(forwarded).toMatchObject({
      project_id: P,
      gates: ['dead_handler', 'api_contract', 'spec_drift'],
      findings: [DEAD_HANDLER],
      discovered_apis: ['GET /v1/a'],
      spec_diff_findings: [spec],
    })
  })

  it('answers the gate runs at data.runs, not nested a second time', async () => {
    const res = await run({ gates: ['dead_handler'], findings: [DEAD_HANDLER] })
    expect(res.json.data?.overall).toBe('fail')
    expect(res.json.data?.runs).toEqual([{ gate: 'dead_handler', status: 'fail', findings_count: 1, run_id: 'r1' }])
  })

  it('refuses malformed evidence instead of forwarding it', async () => {
    const res = await run({ gates: ['dead_handler'], findings: [{ ...DEAD_HANDLER, gate: 'crawl' }] })
    expect(res.status).toBe(400)
    expect(res.json.error?.code).toBe('INVALID_BODY')
    expect(forwarded).toBeNull()
  })

  it('a failed inventory-gates call is an error, not ok', async () => {
    gatesAnswer = { status: 500, body: { ok: false, error: { code: 'BOOM', message: 'x' } } }
    const res = await run({ gates: ['status_claim'] })
    expect(res.status).toBe(502)
    expect(res.json.ok).toBe(false)
  })
})

describe('gateEvidenceFromBody', () => {
  it('keeps only the evidence fields that were sent', () => {
    expect(gateEvidenceFromBody({ gates: ['x'] })).toEqual({ ok: true, fields: {} })
    expect(gateEvidenceFromBody({ discovered_apis: ['GET /a'] })).toEqual({ ok: true, fields: { discovered_apis: ['GET /a'] } })
  })

  it('accepts what discover-api and spec-drift produce, cutting long text instead of refusing it', () => {
    // discoverRoutes() yields "METHOD:path" strings; runSpecDrift() falls back to
    // a whole JSON item as the message, and an oasdiff item can have empty text.
    const out = gateEvidenceFromBody({
      discovered_apis: ['GET:/api/users/[id]', 'POST:/api/checkout'],
      spec_diff_findings: [
        { severity: 'warn', rule_id: 'spec-drift-parse-error', message: 'x'.repeat(3_000) },
        { severity: 'error', rule_id: 'api-removed', message: '', path: '/v1/a', method: 'GET' },
      ],
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.fields.discovered_apis).toEqual(['GET:/api/users/[id]', 'POST:/api/checkout'])
    expect(out.fields.spec_diff_findings?.[0].message).toHaveLength(2_000)
    expect(out.fields.spec_diff_findings?.[1].message).toBe('(no message)')
  })

  it('caps the number of findings', () => {
    const many = Array.from({ length: 2_001 }, () => DEAD_HANDLER)
    expect(gateEvidenceFromBody({ findings: many }).ok).toBe(false)
  })
})
