/**
 * FILE: report-false-alarm-close.test.ts
 * PURPOSE: A false alarm is stored only for a report Mushi's own check filed.
 *          The list and the report page both return `source`, which is what
 *          shows that reason in the console.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { closedReasonAllowed, silentClosedReason } from '../../supabase/functions/_shared/report-close-reasons.ts'

const P = '1000000d-0000-4000-8000-000000000001'
const AUDIT = '2000000d-0000-4000-8000-000000000001'
const WIDGET = '2000000d-0000-4000-8000-000000000002'
const USER = '3000000d-0000-4000-8000-000000000001'

let db: FakeDb
const reportSelects: string[] = []

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'apiKey')
    c.set('projectId', P)
    c.set('isOrgScopedKey', false)
    await next()
  }
  return { jwtAuth: pass, adminOrApiKey: () => pass, apiKeyAuth: pass }
})
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'srk' : undefined) },
  }
  const { registerReportsRoutes } = await import('../../supabase/functions/api/routes/reports.ts')
  app = new Hono()
  registerReportsRoutes(app as never)
})

beforeEach(() => {
  reportSelects.length = 0
  db = makeFakeDb({
    projects: [{ id: P, name: 'App' }],
    reports: [
      {
        id: AUDIT,
        project_id: P,
        source: 'site_audit',
        status: 'classified',
        reporter_token_hash: 'site-audit',
        description: 'missing title',
        screenshot_url: 'https://example.test/s.png',
        created_at: '2026-10-23T00:00:00Z',
      },
      {
        id: WIDGET,
        project_id: P,
        source: 'widget',
        status: 'classified',
        reporter_token_hash: 'rk1_person',
        description: 'button dead',
        screenshot_url: 'https://example.test/s.png',
        created_at: '2026-10-23T00:00:00Z',
      },
    ],
  })
  const orig = db.from.bind(db)
  db.from = (name: string) => {
    const q = orig(name)
    if (name !== 'reports') return q
    const select = q.select.bind(q)
    q.select = ((cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (typeof cols === 'string') reportSelects.push(cols)
      return select(cols, opts)
    }) as typeof q.select
    return q
  }
  const rpcResult = { data: null, error: null }
  db.rpc = () => {
    const pending = Promise.resolve(rpcResult) as Promise<typeof rpcResult> & { maybeSingle: () => Promise<typeof rpcResult> }
    pending.maybeSingle = () => Promise.resolve(rpcResult)
    return pending as never
  }
})

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } }
  return { status: res.status, json }
}

describe('false alarm close', () => {
  it('allows the reason only for a check Mushi filed, and tells nobody', () => {
    for (const source of ['site_audit', 'site_watch', 'security_advisory', 'fresh_eyes', 'code_audit']) {
      expect(closedReasonAllowed('false_alarm', source)).toBe(true)
    }
    expect(closedReasonAllowed('false_alarm', 'widget')).toBe(false)
    expect(closedReasonAllowed('false_alarm', null)).toBe(false)
    expect(closedReasonAllowed('wont_fix', 'widget')).toBe(true)
    expect(silentClosedReason('false_alarm')).toBe(true)
    expect(silentClosedReason('wont_fix')).toBe(false)
  })

  it('the list and the report page both return source', async () => {
    const list = await call('GET', '/v1/admin/reports')
    expect(list.status).toBe(200)
    const rows = (list.json.data?.reports ?? []) as Array<{ id: string; source: string }>
    expect(rows.find((r) => r.id === AUDIT)?.source).toBe('site_audit')
    expect(rows.find((r) => r.id === WIDGET)?.source).toBe('widget')
    expect(reportSelects.some((cols) => /(^|, )source(,|$)/.test(cols))).toBe(true)

    reportSelects.length = 0
    const detail = await call('GET', `/v1/admin/reports/${AUDIT}`)
    expect(detail.status).toBe(200)
    expect(detail.json.data?.source).toBe('site_audit')
    expect(reportSelects).toContain('*')
  })

  it('stores false_alarm on a site audit and rejects it on a widget report', async () => {
    const ok = await call('PATCH', `/v1/admin/reports/${AUDIT}`, { status: 'dismissed', closed_reason: 'false_alarm' })
    expect(ok.status).toBe(200)
    expect(db.table('reports').find((r) => r.id === AUDIT)).toMatchObject({ status: 'dismissed', closed_reason: 'false_alarm' })
    await new Promise((r) => setTimeout(r, 0))
    expect(db.table('reporter_notifications')).toEqual([])

    const denied = await call('PATCH', `/v1/admin/reports/${WIDGET}`, { status: 'dismissed', closed_reason: 'false_alarm' })
    expect(denied.status).toBe(400)
    expect(denied.json.error?.code).toBe('VALIDATION_ERROR')
    expect(db.table('reports').find((r) => r.id === WIDGET)?.status).toBe('classified')
    expect(db.table('reports').find((r) => r.id === WIDGET)?.closed_reason).toBeUndefined()
  })
})
