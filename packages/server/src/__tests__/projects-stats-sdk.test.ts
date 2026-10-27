/**
 * FILE: projects-stats-sdk.test.ts
 * PURPOSE: GET /v1/admin/projects/stats counts a project as "SDK connected"
 *          only when an SDK key (report:write, no MCP scope) has checked in,
 *          and never says every project is ingesting while one has no SDK
 *          heartbeat: it names the project and links its SDK health fixes
 *          (lets-talk, 2026-10-26).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const A = '1000000a-0000-4000-8000-000000000000'
const B = '1000000b-0000-4000-8000-000000000000'
const USER = '2000000a-0000-4000-8000-000000000000'
let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportMessage: () => {} }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass }
})
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, enumerateAccessibleProjectIds: async () => [A, B] }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerProjectsCrudRoutes } = await import('../../supabase/functions/api/routes/projects-crud.ts')
  app = new Hono()
  registerProjectsCrudRoutes(app as never)
})

const now = new Date().toISOString()

beforeEach(() => {
  db = makeFakeDb({
    projects: [
      { id: A, name: 'glot.it' },
      { id: B, name: 'lets-talk' },
    ],
    project_api_keys: [
      { project_id: A, is_active: true, scopes: ['report:write'], last_seen_at: now },
      // lets-talk: only an MCP key has checked in. That is the editor, not the app.
      { project_id: B, is_active: true, scopes: ['report:write', 'mcp:read'], last_seen_at: now },
      { project_id: B, is_active: true, scopes: ['report:write'], last_seen_at: null },
    ],
    reports: [
      { id: 'r1', project_id: A, created_at: now },
      { id: 'r2', project_id: B, created_at: now },
    ],
  })
})

async function stats() {
  const res = await app.request('/v1/admin/projects/stats')
  return ((await res.json()) as { data: Record<string, any> }).data
}

describe('GET /v1/admin/projects/stats', () => {
  it('does not count an MCP key heartbeat as SDK connected, and names the app without one', async () => {
    const data = await stats()
    expect(data.sdkConnectedCount).toBe(1)
    expect(data.sdkMissingCount).toBe(1)
    expect(data.sdkMissingProjects).toEqual([{ id: B, name: 'lets-talk' }])
    expect(data.topPriority).toBe('sdk_missing')
    expect(data.topPriorityLabel).toContain('lets-talk has no SDK heartbeat')
    expect(data.topPriorityTo).toBe(`/connect?project=${B}#connect-sdk-health`)
  })

  it('is healthy only when every app has an SDK check-in', async () => {
    db.table('project_api_keys').push({ project_id: B, is_active: true, scopes: ['report:write'], last_seen_at: now })
    const data = await stats()
    expect(data.sdkConnectedCount).toBe(2)
    expect(data.sdkMissingProjects).toEqual([])
    expect(data.topPriority).toBe('healthy')
  })

  it('a revoked SDK key does not count', async () => {
    db.table('project_api_keys').push({ project_id: B, is_active: false, scopes: ['report:write'], last_seen_at: now })
    expect((await stats()).topPriority).toBe('sdk_missing')
  })
})
