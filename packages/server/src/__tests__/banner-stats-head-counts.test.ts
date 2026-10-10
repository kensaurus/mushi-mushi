/**
 * The drift and anomalies banner endpoints read every row and counted in JS.
 * PostgREST caps a select at max_rows (1,000 on Supabase), so past that the
 * banner undercounted. Both now use head counts; the fake DB here caps
 * selects at 3 rows so a row-counting implementation fails.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
let db: FakeDb

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/middleware/auth.ts', () => ({
  requireAuth: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1')
    c.set('authMethod', 'jwt')
    await next()
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ownedProjectIds: async () => [P],
  resolveOwnedProject: async () => ({ project: { id: P, name: 'App' }, explicit: true }),
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerDriftRoutes } = await import('../../supabase/functions/api/routes/drift.ts')
  const { registerAnomaliesRoutes } = await import('../../supabase/functions/api/routes/anomalies.ts')
  app = new Hono()
  registerDriftRoutes(app as never)
  registerAnomaliesRoutes(app as never)
})

const rows = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i))

beforeEach(() => {
  db = makeFakeDb(
    {
      drift_findings: [
        ...rows(4, (i) => ({ id: `c${i}`, project_id: P, status: 'open', severity: 'critical', surface: 'api', created_at: `2026-10-0${i + 1}` })),
        ...rows(2, (i) => ({ id: `w${i}`, project_id: P, status: 'open', severity: 'warn', surface: 'db', created_at: '2026-09-01' })),
      ],
      contract_snapshots: [],
      anomaly_detections: [
        ...rows(4, (i) => ({ id: `d${i}`, project_id: P, status: 'dismissed', confirmed: false, auto_report_id: null, method: 'z', score: 1, threshold: 3, detected_at: `2026-10-0${i + 1}` })),
        ...rows(4, (i) => ({ id: `k${i}`, project_id: P, status: 'confirmed', confirmed: true, auto_report_id: `r${i}`, method: 'z', score: 5, threshold: 3, detected_at: '2026-09-01' })),
      ],
      metric_series: [],
    },
    { maxRows: 3 },
  )
})

describe('GET /v1/admin/drift/stats', () => {
  it('counts every open finding past the row cap', async () => {
    const res = await app.request('/v1/admin/drift/stats')
    const body = (await res.json()) as { data: Record<string, number> }
    expect(body.data.openFindings).toBe(6)
    expect(body.data.criticalOpen).toBe(4)
  })
})

describe('GET /v1/admin/anomalies/stats', () => {
  it('counts every detection past the row cap', async () => {
    const res = await app.request('/v1/admin/anomalies/stats')
    const body = (await res.json()) as { data: Record<string, number | string | null> }
    expect(body.data.dismissedAnomalies).toBe(4)
    expect(body.data.confirmedAnomalies).toBe(4)
    expect(body.data.autoReported).toBe(4)
    expect(body.data.lastDetectionAt).toBe('2026-10-04')
  })
})
