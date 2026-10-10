/**
 * POST /v1/a2a/tasks (classify_report / judge_fix) looked the report up with
 * .single() and ignored `error`, so a DB failure reached the A2A caller as
 * 404 "Report not found". It now uses maybeSingle and answers 500 on error.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const R = '3000000a-0000-4000-8000-000000000000'
let db: FakeDb
let failing: string | null = null

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/idempotency.ts', () => ({
  withIdempotency: (_c: unknown, fn: () => Promise<Response>) => fn(),
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1')
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerCanAccessProject: async () => ({ allowed: true, role: 'owner' }),
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerA2ATaskRoutes } = await import('../../supabase/functions/api/routes/a2a-tasks.ts')
  app = new Hono()
  registerA2ATaskRoutes(app as never)
})

beforeEach(() => {
  failing = null
  db = makeFakeDb({ reports: [], fix_attempts: [], fix_dispatch_jobs: [] }, {
    failRead: (t) => (t === failing ? 'connection reset' : null),
  })
})

async function task(skill: string) {
  const res = await app.request('/v1/a2a/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skill, input: { reportId: R, projectId: P } }),
  })
  return { status: res.status, json: (await res.json()) as { error?: { code: string } } }
}

describe('POST /v1/a2a/tasks report lookup', () => {
  it('a missing report is still 404', async () => {
    const res = await task('classify_report')
    expect(res.status).toBe(404)
    expect(res.json.error?.code).toBe('NOT_FOUND')
  })

  it('a failed lookup is 500, not 404', async () => {
    failing = 'reports'
    const res = await task('classify_report')
    expect(res.status).toBe(500)
    expect(res.json.error?.code).toBe('DB_ERROR')
  })
})
