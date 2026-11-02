/**
 * FILE: fixes-summary-ci-passing.test.ts
 * PURPOSE: GET /v1/admin/fixes/summary no longer returns the deprecated
 *          `prsMerged` alias. The count of check-runs that concluded
 *          `success` is `prsCiPassing` only (report bed1653a).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '1000000d-0000-4000-8000-000000000000'
const USER = '2000000d-0000-4000-8000-000000000000'

let db: FakeDb
let ownedIds: string[] = []

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next() }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/fix-report-truth-load.ts', () => ({
  loadReportFixTruths: async () => ({ truths: new Map(), reports: new Map() }),
  loadRecentFixTruths: async () => ({ truths: new Map() }),
  reportTitle: () => null,
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    callerProjectIds: async () => ownedIds,
    scopedOwnedProjectIds: async () => ownedIds,
  }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerQueryFixesRepoRoutes } = await import('../../supabase/functions/api/routes/query-fixes-repo.ts')
  app = new Hono()
  registerQueryFixesRepoRoutes(app as never)
})

function attempt(i: number, extra: Row = {}): Row {
  return {
    id: `f${i}`,
    project_id: P,
    report_id: `r${i}`,
    status: 'completed',
    created_at: new Date().toISOString(),
    check_run_conclusion: null,
    ...extra,
  }
}

async function summary() {
  const res = await app.request('/v1/admin/fixes/summary')
  return { status: res.status, json: (await res.json()) as { ok: boolean; data: Record<string, unknown> } }
}

describe('GET /v1/admin/fixes/summary', () => {
  it('omits prsMerged when the caller has no projects', async () => {
    ownedIds = []
    db = makeFakeDb({})
    const res = await summary()
    expect(res.status).toBe(200)
    expect(res.json.data.prsCiPassing).toBe(0)
    expect(res.json.data).not.toHaveProperty('prsMerged')
  })

  it('counts CI-passing attempts as prsCiPassing and does not alias that count', async () => {
    ownedIds = [P]
    db = makeFakeDb({
      fix_attempts: [
        attempt(1, { check_run_conclusion: 'success', merged_at: null }),
        attempt(2, { check_run_conclusion: 'success', merged_at: '2026-10-01T00:00:00Z' }),
        attempt(3, { check_run_conclusion: 'failure', merged_at: '2026-10-02T00:00:00Z' }),
        attempt(4, { check_run_conclusion: null }),
      ],
    })
    const res = await summary()
    expect(res.status).toBe(200)
    expect(res.json.data.prsCiPassing).toBe(2)
    expect(res.json.data.total).toBe(4)
    expect(res.json.data).not.toHaveProperty('prsMerged')
  })
})
