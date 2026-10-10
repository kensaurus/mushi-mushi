/**
 * POST /v1/sdk/discovery soft throttle.
 *
 * It dropped any event when a row existed for (project, route) in the last
 * minute, whoever sent it, so on a busy route only the first user of each
 * minute was recorded and discovery_observed_inventory's distinct_users /
 * observation_count undercounted. The throttle is now per user; anonymous
 * events still share one slot per route.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const U1 = 'a'.repeat(64)
const U2 = 'b'.repeat(64)
let db: FakeDb

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('projectId', P)
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/webhook-middleware.ts', () => {
  class ReplayAttackError extends Error {}
  class RateLimitError extends Error {}
  return { createWebhookMiddleware: () => ({}), ReplayAttackError, RateLimitError }
})
vi.mock('../../supabase/functions/api/routes/cli-auth.ts', () => ({
  claimIpRateLimit: async () => null,
  extractClientIp: () => '203.0.113.1',
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerPublicRoutes } = await import('../../supabase/functions/api/routes/public.ts')
  app = new Hono()
  registerPublicRoutes(app as never)
})

beforeEach(() => {
  db = makeFakeDb({ discovery_events: [] }, { autoId: true })
})

async function send(user: string | null) {
  const res = await app.request('/v1/sdk/discovery', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: '/checkout', user_id_hash: user }),
  })
  return ((await res.json()) as { data: { accepted: boolean } }).data.accepted
}

describe('discovery throttle', () => {
  it('records a second user on the same route in the same minute', async () => {
    expect(await send(U1)).toBe(true)
    expect(await send(U2)).toBe(true)
    expect(db.tables.discovery_events).toHaveLength(2)
  })

  it('still drops a repeat from the same user', async () => {
    expect(await send(U1)).toBe(true)
    expect(await send(U1)).toBe(false)
  })

  it('anonymous events share one slot per route', async () => {
    expect(await send(null)).toBe(true)
    expect(await send(null)).toBe(false)
    expect(await send(U1)).toBe(true)
  })
})
