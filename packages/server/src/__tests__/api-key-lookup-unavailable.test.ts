/**
 * A failed API-key lookup is "try again" (503 AUTH_UNAVAILABLE), never
 * "revoked" (401 INVALID_API_KEY). On 2026-10-30 a one-second gateway error
 * made the local worker read INVALID_API_KEY, stop for good and stay offline
 * for 11 hours, though its key was fine.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ reply: { data: null as unknown, error: null as unknown } }))

function chain() {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit']) q[m] = () => q
  q.single = () => Promise.resolve(state.reply)
  q.maybeSingle = () => Promise.resolve(state.reply)
  q.then = (r: (v: unknown) => void) => r(state.reply)
  return q
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({ from: () => chain(), rpc: () => Promise.resolve({ data: null, error: null }) }) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let auth: typeof import('../../supabase/functions/_shared/auth.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  auth = await import('../../supabase/functions/_shared/auth.ts')
})

function ctx(headers: Record<string, string>) {
  const vars: Record<string, unknown> = {}
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    get: (k: string) => vars[k],
    set: (k: string, v: unknown) => { vars[k] = v },
    req: { header: (k: string) => lower[k.toLowerCase()], query: () => undefined, path: '/v1/worker/heartbeat', method: 'POST', url: 'https://x/v1/worker/heartbeat' },
    json: (body: unknown, status = 200, extra?: Record<string, string>) => ({ body, status, headers: extra }),
  }
}

type Res = { status: number; body: { error: { code: string } }; headers?: Record<string, string> }

describe('API key lookup failures', () => {
  it('a worker key answers 503 with Retry-After when the lookup errors, and 401 only when no key matches', async () => {
    const mw = auth.adminOrApiKey({ scope: 'worker:run' })
    const next = vi.fn(async () => {})

    state.reply = { data: null, error: { code: '', message: '<!DOCTYPE html> 502 Bad gateway' } }
    const down = (await mw(ctx({ 'X-Mushi-Api-Key': 'mushi_test_key' }) as never, next)) as unknown as Res
    expect(down.status).toBe(503)
    expect(down.body.error.code).toBe('AUTH_UNAVAILABLE')
    expect(down.headers).toEqual({ 'Retry-After': '30' })

    state.reply = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    const missing = (await mw(ctx({ 'X-Mushi-Api-Key': 'mushi_test_key' }) as never, next)) as unknown as Res
    expect(missing.status).toBe(401)
    expect(missing.body.error.code).toBe('INVALID_API_KEY')
    expect(next).not.toHaveBeenCalled()
  })

  it('the SDK ingest key check reads a failed lookup the same way', async () => {
    const next = vi.fn(async () => {})
    state.reply = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    const down = (await auth.apiKeyAuth(ctx({ 'X-Mushi-Api-Key': 'mushi_test_key' }) as never, next)) as unknown as Res
    expect(down.status).toBe(503)
    state.reply = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    const missing = (await auth.apiKeyAuth(ctx({ 'X-Mushi-Api-Key': 'mushi_test_key' }) as never, next)) as unknown as Res
    expect(missing.status).toBe(401)
  })
})
