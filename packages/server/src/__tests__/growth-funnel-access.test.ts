/**
 * GET /v1/admin/growth/funnel (gap #28): the console JWT or an account-level
 * API key, and only for an operator. The company funnel counts every tenant,
 * so a key bound to one project is refused even when its owner is an operator.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn(async () => ({ data: { weeks: [{ week: '2026-09-28', signups: 3 }], by_source: [], self_project_configured: true }, error: null }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({ rpc }) }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

const OPERATOR = '0000000a-0000-4000-8000-0000000000aa'
const TENANT = '0000000b-0000-4000-8000-0000000000bb'

type Handler = (c: unknown) => Promise<unknown>
let handler: Handler
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === 'MUSHI_OPERATOR_USER_IDS' ? OPERATOR : process.env[k]) } }
  const { registerGrowthRoutes } = await import('../../supabase/functions/api/routes/growth.ts')
  const app = {
    get: (_path: string, ...handlers: Handler[]) => { handler = handlers[handlers.length - 1] },
  }
  registerGrowthRoutes(app as never)
})
beforeEach(() => rpc.mockClear())

async function call(vars: Record<string, unknown>): Promise<{ status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }> {
  const c = {
    req: { query: () => undefined, header: () => undefined },
    get: (k: string) => vars[k],
    json: (body: unknown, status = 200) => ({ body, status }),
  }
  return (await handler(c)) as { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
}

describe('growth funnel access', () => {
  it('serves an operator signed in to the console', async () => {
    const res = await call({ userId: OPERATOR, authMethod: 'jwt' })
    expect(res.status).toBe(200)
    expect(res.body.data?.weeks).toHaveLength(1)
  })

  it('serves an operator\'s account-level key', async () => {
    const res = await call({ userId: OPERATOR, authMethod: 'apiKey', isOrgScopedKey: true })
    expect(res.status).toBe(200)
  })

  it('refuses a project-bound key, even an operator\'s, before reading the funnel', async () => {
    const res = await call({ userId: OPERATOR, authMethod: 'apiKey', isOrgScopedKey: false, projectId: TENANT })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('GROWTH_NEEDS_ACCOUNT_KEY')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses an account-level key whose owner is not an operator', async () => {
    const res = await call({ userId: TENANT, authMethod: 'apiKey', isOrgScopedKey: true })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('FORBIDDEN')
    expect(rpc).not.toHaveBeenCalled()
  })
})
