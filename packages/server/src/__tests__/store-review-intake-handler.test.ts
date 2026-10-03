/**
 * The store-review-intake edge entry: a failure to read the projects is a 500
 * with a stable code and a fixed message. The database error goes to the log,
 * never into the response body.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const failingChain = {
  select: () => failingChain,
  eq: () => failingChain,
  order: () => failingChain,
  limit: () => failingChain,
  then: (ok: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: { message: 'permission denied for table project_settings at /srv/db.ts:12' } }).then(ok),
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({ from: () => failingChain }),
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  requireServiceRoleAuth: () => null,
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (_name: string, h: unknown) => h,
  reportError: vi.fn(),
  reportMessage: vi.fn(),
}))

let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  ;({ handler } = await import('../../supabase/functions/store-review-intake/index.ts'))
})

describe('store-review-intake handler', () => {
  it('answers a projects read failure with a code and a fixed message, not the database error', async () => {
    const res = await handler(new Request('https://x.test/store-review-intake', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: 'PROJECTS_READ_FAILED', message: 'Could not read the projects to pull.' },
    })
    expect(text).not.toContain('permission denied')
    expect(text).not.toContain('/srv/')
  })
})
