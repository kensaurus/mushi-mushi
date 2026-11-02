/**
 * FILE: packages/server/src/__tests__/reports-all-apps-stats.test.ts
 * PURPOSE: All-apps report totals are opt-in and add up.
 *
 * `GET /reports/stats` counts every app only when the client sends `?apps=all`
 * and does not pin one. `severity-stats` without a pin already counts every
 * app the caller can open; a pin counts that app. Headline counts are exact
 * even when the day scan is capped.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const USER = '20000000-0000-4000-8000-00000000000b'
const ORG = '30000000-0000-4000-8000-00000000000c'
const PA = '10000000-0000-4000-8000-00000000000a'
const PB = '10000000-0000-4000-8000-00000000000d'

const state = vi.hoisted(() => ({ db: null as FakeDb | null }))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => state.db,
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: () => undefined },
  }
  const { registerReportsRoutes } = await import('../../supabase/functions/api/routes/reports.ts')
  app = new Hono()
  registerReportsRoutes(app as never)
})

function seed(maxRows?: number) {
  const now = new Date().toISOString()
  const reports = [
    { id: 'r1', project_id: PA, severity: 'critical', status: 'new', created_at: now },
    { id: 'r2', project_id: PA, severity: 'critical', status: 'new', created_at: now },
    { id: 'r3', project_id: PB, severity: 'high', status: 'new', created_at: now },
    { id: 'r4', project_id: PB, severity: 'medium', status: 'queued', created_at: now },
    { id: 'r5', project_id: PB, severity: 'low', status: 'classified', created_at: now },
  ]
  state.db = makeFakeDb(
    {
      organization_members: [{ user_id: USER, organization_id: ORG, role: 'owner' }],
      project_members: [],
      projects: [
        { id: PA, name: 'Alpha', organization_id: ORG, owner_id: USER, created_at: '2020-01-01T00:00:00.000Z' },
        { id: PB, name: 'Beta', organization_id: ORG, owner_id: USER, created_at: '2021-01-01T00:00:00.000Z' },
      ],
      reports,
      project_api_keys: [],
    },
    maxRows == null ? {} : { maxRows },
  )
}

beforeEach(() => {
  seed()
})

async function get(path: string, projectId?: string) {
  const res = await app.request(path, {
    headers: projectId ? { 'X-Mushi-Project-Id': projectId } : {},
  })
  const json = (await res.json()) as { ok: boolean; data: Record<string, any> }
  return { status: res.status, data: json.data }
}

function severitySum(data: { bySeverity?: Record<string, number> }): number {
  return Object.values(data.bySeverity ?? {}).reduce((sum, n) => sum + n, 0)
}

function byDaySum(data: { byDay?: Array<{ total: number }> }): number {
  return (data.byDay ?? []).reduce((sum, day) => sum + day.total, 0)
}

describe('report stats across apps', () => {
  it('?apps=all totals equal the per-app sums; a missing pin stays on one app', async () => {
    const all = await get('/v1/admin/reports/stats?apps=all')
    const alpha = await get('/v1/admin/reports/stats', PA)
    const beta = await get('/v1/admin/reports/stats', PB)
    const unpinned = await get('/v1/admin/reports/stats')
    const pinnedAndAsked = await get('/v1/admin/reports/stats?apps=all', PA)

    expect(all.status).toBe(200)
    expect(all.data.projectName).toBe('All apps')
    expect(all.data.totalAllTime).toBe(alpha.data.totalAllTime + beta.data.totalAllTime)
    expect(all.data.total14d).toBe(alpha.data.total14d + beta.data.total14d)
    expect(all.data.critical14d).toBe(alpha.data.critical14d + beta.data.critical14d)
    expect(all.data.high14d).toBe(alpha.data.high14d + beta.data.high14d)
    expect(all.data.totalAllTime).toBe(5)
    expect(alpha.data.totalAllTime).toBe(2)
    expect(beta.data.totalAllTime).toBe(3)

    expect(unpinned.data.projectId).toBe(PA)
    expect(unpinned.data.totalAllTime).toBe(alpha.data.totalAllTime)
    expect(unpinned.data.totalAllTime).not.toBe(all.data.totalAllTime)

    expect(pinnedAndAsked.data.projectId).toBe(PA)
    expect(pinnedAndAsked.data.totalAllTime).toBe(2)
  })

  it('severity-stats without a pin equals the per-app sums', async () => {
    const all = await get('/v1/admin/reports/severity-stats?days=14')
    const alpha = await get('/v1/admin/reports/severity-stats?days=14', PA)
    const beta = await get('/v1/admin/reports/severity-stats?days=14', PB)

    expect(all.data.total).toBe(alpha.data.total + beta.data.total)
    expect(severitySum(all.data)).toBe(severitySum(alpha.data) + severitySum(beta.data))
    expect(all.data.total).toBe(5)
    expect(all.data.bySeverity.critical).toBe(2)
    expect(all.data.bySeverity.high).toBe(1)
    expect(all.data.byDayCapped).toBe(false)
    expect(byDaySum(all.data)).toBe(all.data.total)
  })

  it('hides the sparkline flag when All apps outgrows the row scan', async () => {
    seed(2)
    const all = await get('/v1/admin/reports/severity-stats?days=14')
    expect(all.data.total).toBe(5)
    expect(severitySum(all.data)).toBe(5)
    expect(byDaySum(all.data)).toBeLessThan(all.data.total)
    expect(all.data.byDayCapped).toBe(true)
  })
})
