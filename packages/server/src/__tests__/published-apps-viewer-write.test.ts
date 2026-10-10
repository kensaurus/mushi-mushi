/**
 * /v1/admin/published-apps/* (the marketplace listing).
 *
 * The routes only checked membership, so an org viewer could edit, publish
 * or pause the listing, replace bounties and raise the marketplace budget.
 * Viewers keep read access; every PUT/POST refuses them.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '2000000b-0000-4000-8000-000000000000'
const ORG = '3000000c-0000-4000-8000-000000000000'
let db: FakeDb
let caller = 'viewer-user'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', caller)
    await next()
  },
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerPublishedAppsRoutes } = await import('../../supabase/functions/api/routes/published-apps.ts')
  app = new Hono()
  registerPublishedAppsRoutes(app as never)
})

beforeEach(() => {
  caller = 'viewer-user'
  db = makeFakeDb(
    {
      projects: [{ id: P, owner_id: 'owner-user', organization_id: ORG }],
      organization_members: [
        { organization_id: ORG, user_id: 'viewer-user', role: 'viewer' },
        { organization_id: ORG, user_id: 'member-user', role: 'member' },
      ],
      project_members: [],
      published_apps: [{ project_id: P, name: 'App', visibility: 'public' }],
    },
    { rpc: (fn) => (fn === 'get_org_feature_flags' ? { marketplace_publish: true } : null) },
  )
})

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('published-apps viewer gate', () => {
  it('lets a viewer read the listing', async () => {
    const res = await call('GET', `/v1/admin/published-apps/${P}`)
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ name: 'App' })
  })

  it.each([
    ['PUT', '', { name: 'Renamed' }],
    ['POST', '/publish', undefined],
    ['POST', '/pause', undefined],
    ['PUT', '/targeting', { languages: ['en'] }],
    ['PUT', '/bounties', { bounties: [{ action: 'bug', points_per_event: 10 }] }],
    ['PUT', '/marketplace-settings', { marketplace_monthly_budget_usd: 5000 }],
  ])('refuses a viewer on %s %s', async (method, suffix, body) => {
    const res = await call(method, `/v1/admin/published-apps/${P}${suffix}`, body)
    expect(res.status).toBe(403)
    expect(res.json.error?.code).toBe('FORBIDDEN')
    expect(db.table('published_apps')[0]).toMatchObject({ name: 'App', visibility: 'public' })
  })

  it('still lets a member pause the listing', async () => {
    caller = 'member-user'
    const res = await call('POST', `/v1/admin/published-apps/${P}/pause`)
    expect(res.status).toBe(200)
    expect(db.table('published_apps')[0]).toMatchObject({ visibility: 'paused' })
  })

  it('refuses a caller with no access to the project', async () => {
    caller = 'stranger'
    const res = await call('GET', `/v1/admin/published-apps/${P}`)
    expect(res.status).toBe(403)
  })
})
