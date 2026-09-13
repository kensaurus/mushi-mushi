/**
 * `api/routes/push.ts` — developer Web Push endpoints.
 *
 * Handlers are registered on a fake Hono app and driven directly with a fake
 * Context; the sender, VAPID config, rate limiter and DB are injected through
 * `PushRouteDeps`. Covers: public VAPID key (configured / 503), subscription
 * body validation (JSON, host allow-list, key lengths), upsert idempotency on
 * (user, endpoint), delete, and the test-ping outcomes (429 / 503 / 404 / 502 /
 * 200).
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportError: vi.fn(),
  reportMessage: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', () => ({
  claimTenantRateLimit: vi.fn(async () => ({ allowed: true })),
}))

type PushModule = typeof import('../../supabase/functions/api/routes/push.ts')
let push: PushModule

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  push = await import('../../supabase/functions/api/routes/push.ts')
})

// ── fake Hono surface ────────────────────────────────────────────────────────

type Handler = (c: FakeContext, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes = new Map<string, Handler[]>()
  get(path: string, ...handlers: Handler[]) {
    this.routes.set(`GET ${path}`, handlers)
  }
  post(path: string, ...handlers: Handler[]) {
    this.routes.set(`POST ${path}`, handlers)
  }
  delete(path: string, ...handlers: Handler[]) {
    this.routes.set(`DELETE ${path}`, handlers)
  }
  async call(method: string, path: string, c: FakeContext): Promise<JsonResult> {
    const handlers = this.routes.get(`${method} ${path}`)
    if (!handlers) throw new Error(`no route ${method} ${path}`)
    // Run middleware chain then the terminal handler, like Hono does.
    let result: unknown
    const run = async (i: number): Promise<void> => {
      const h = handlers[i]
      if (i === handlers.length - 1) {
        result = await h(c)
        return
      }
      // A middleware that short-circuits (auth failure) returns its own
      // response; one that calls next() resolves to undefined and the
      // terminal handler's result stands.
      const short = await h(c, () => run(i + 1))
      if (result === undefined && short !== undefined) result = short
    }
    await run(0)
    return result as JsonResult
  }
}

interface JsonResult {
  body: Record<string, unknown>
  status: number
  headers: Record<string, string>
}

const INVALID_JSON = Symbol('invalid-json')

interface FakeContext {
  req: { json: () => Promise<unknown>; header: (k: string) => string | undefined; path: string; method: string }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  header: (k: string, v: string) => void
  json: (body: Record<string, unknown>, status?: number) => JsonResult
}

function ctx(opts: { body?: unknown; userId?: string } = {}): FakeContext {
  const headers: Record<string, string> = {}
  const vars: Record<string, unknown> = { userId: opts.userId ?? 'user-1', requestId: 'req-1' }
  return {
    req: {
      json: async () => {
        if (opts.body === INVALID_JSON) throw new SyntaxError('Unexpected token')
        return opts.body
      },
      header: () => undefined,
      path: '/v1/push',
      method: 'POST',
    },
    get: (k) => vars[k],
    set: (k, v) => {
      vars[k] = v
    },
    header: (k, v) => {
      headers[k] = v
    },
    json: (body, status = 200) => ({ body, status, headers }),
  }
}

const VAPID = { publicKey: 'BPUBLICKEY', privateKey: 'private', subject: 'mailto:ops@example.test' }
const P256DH = Buffer.from(new Uint8Array([0x04, ...new Array(64).fill(7)])).toString('base64url')
const AUTH = Buffer.from(new Uint8Array(16).fill(9)).toString('base64url')
const SUB_FCM = 'https://fcm.googleapis.com/fcm/send/abc'
const SUB_APPLE = 'https://web.push.apple.com/XYZ'

function harness(overrides: Partial<PushModule['PushRouteDeps']> = {}, db: FakeDb = makeFakeDb({}, { uniques: { user_push_subscriptions: ['user_id', 'endpoint'] } })) {
  const app = new FakeApp()
  const deps = {
    getServiceClient: () => db as never,
    jwtAuth: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    getVapidConfig: () => VAPID,
    sendWebPushToUser: vi.fn(async () => ({ sent: 1, failed: 0 })),
    claimTenantRateLimit: vi.fn(async () => ({ allowed: true })),
    ...overrides,
  }
  push.registerPushRoutes(app as never, deps as never)
  return { app, deps, db }
}

// ── parsePushSubscriptionBody ────────────────────────────────────────────────

describe('parsePushSubscriptionBody', () => {
  const good = { endpoint: SUB_FCM, keys: { p256dh: P256DH, auth: AUTH }, expirationTime: null }

  it('accepts a browser PushSubscription.toJSON() shape', () => {
    const r = push.parsePushSubscriptionBody({ ...good, user_agent: 'Mozilla/5.0', project_id: '11111111-2222-4333-8444-555555555555' })
    expect(r).toEqual({
      ok: true,
      value: { endpoint: SUB_FCM, p256dh: P256DH, auth: AUTH, user_agent: 'Mozilla/5.0', project_id: '11111111-2222-4333-8444-555555555555' },
    })
  })

  it('rejects missing fields, disallowed hosts and wrong key lengths', () => {
    expect(push.parsePushSubscriptionBody(null).ok).toBe(false)
    expect(push.parsePushSubscriptionBody({ keys: good.keys })).toMatchObject({ ok: false, message: expect.stringMatching(/^endpoint/) })
    expect(push.parsePushSubscriptionBody({ ...good, endpoint: 'https://evil.test/hook' })).toMatchObject({ ok: false, message: expect.stringMatching(/not a supported push service/) })
    expect(push.parsePushSubscriptionBody({ ...good, endpoint: 'http://fcm.googleapis.com/x' })).toMatchObject({ ok: false })
    expect(push.parsePushSubscriptionBody({ ...good, keys: { p256dh: 'AAAA', auth: AUTH } })).toMatchObject({ ok: false, message: expect.stringMatching(/p256dh/) })
    expect(push.parsePushSubscriptionBody({ ...good, keys: { p256dh: P256DH, auth: 'AAAA' } })).toMatchObject({ ok: false, message: expect.stringMatching(/auth/) })
    expect(push.parsePushSubscriptionBody({ ...good, project_id: 'not-a-uuid' })).toMatchObject({ ok: false, message: expect.stringMatching(/project_id/) })
    expect(push.parsePushSubscriptionBody({ ...good, user_agent: 'x'.repeat(600) })).toMatchObject({ ok: false, message: expect.stringMatching(/user_agent/) })
  })
})

// ── GET /v1/push/vapid-public-key ────────────────────────────────────────────

describe('GET /v1/push/vapid-public-key', () => {
  it('returns the public key with a cache header when configured', async () => {
    const { app } = harness()
    const res = await app.call('GET', '/v1/push/vapid-public-key', ctx())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, publicKey: 'BPUBLICKEY' })
    expect(res.headers['Cache-Control']).toBe('public, max-age=3600')
  })

  it('returns 503 push_not_configured when VAPID secrets are unset', async () => {
    const { app } = harness({ getVapidConfig: () => null })
    const res = await app.call('GET', '/v1/push/vapid-public-key', ctx())
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ ok: false, error: { code: 'SERVER_MISCONFIGURED', message: 'push_not_configured', reason: 'push_not_configured' } })
  })
})

// ── POST / DELETE /v1/push/subscriptions ─────────────────────────────────────

describe('POST /v1/push/subscriptions', () => {
  it('rejects non-JSON and invalid bodies with 400', async () => {
    const { app } = harness()
    const bad = await app.call('POST', '/v1/push/subscriptions', ctx({ body: INVALID_JSON }))
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } })

    const ssrf = await app.call('POST', '/v1/push/subscriptions', ctx({ body: { endpoint: 'https://10.0.0.1/x', keys: { p256dh: P256DH, auth: AUTH } } }))
    expect(ssrf.status).toBe(400)
    expect(ssrf.body).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  })

  it('upserts on (user, endpoint) so re-subscribing the same device does not duplicate', async () => {
    const { app, db } = harness()
    const body = { endpoint: SUB_FCM, keys: { p256dh: P256DH, auth: AUTH }, user_agent: 'UA-1' }
    const first = await app.call('POST', '/v1/push/subscriptions', ctx({ body, userId: 'user-1' }))
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ ok: true, subscription: { endpoint: SUB_FCM } })

    await app.call('POST', '/v1/push/subscriptions', ctx({ body: { ...body, user_agent: 'UA-2' }, userId: 'user-1' }))
    await app.call('POST', '/v1/push/subscriptions', ctx({ body: { ...body, endpoint: SUB_APPLE }, userId: 'user-1' }))
    await app.call('POST', '/v1/push/subscriptions', ctx({ body, userId: 'user-2' }))

    const rows = db.table('user_push_subscriptions')
    expect(rows).toHaveLength(3)
    const mine = rows.filter((r) => r.user_id === 'user-1')
    expect(mine.map((r) => r.endpoint).sort()).toEqual([SUB_APPLE, SUB_FCM].sort())
    expect(mine.find((r) => r.endpoint === SUB_FCM)?.user_agent).toBe('UA-2')
    expect(rows.every((r) => r.p256dh === P256DH && r.auth === AUTH)).toBe(true)
  })

  it('returns 500 DB_ERROR when the upsert fails', async () => {
    const failing = {
      from: () => ({
        upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
      }),
    }
    const { app } = harness({ getServiceClient: () => failing as never })
    const res = await app.call('POST', '/v1/push/subscriptions', ctx({ body: { endpoint: SUB_FCM, keys: { p256dh: P256DH, auth: AUTH } } }))
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ ok: false, error: { code: 'DB_ERROR' } })
  })
})

describe('DELETE /v1/push/subscriptions', () => {
  it('removes only the caller’s row for that endpoint', async () => {
    const db = makeFakeDb(
      {
        user_push_subscriptions: [
          { id: 'a', user_id: 'user-1', endpoint: SUB_FCM, p256dh: P256DH, auth: AUTH },
          { id: 'b', user_id: 'user-2', endpoint: SUB_FCM, p256dh: P256DH, auth: AUTH },
        ],
      },
      { uniques: { user_push_subscriptions: ['user_id', 'endpoint'] } },
    )
    const { app } = harness({}, db)
    const res = await app.call('DELETE', '/v1/push/subscriptions', ctx({ body: { endpoint: SUB_FCM }, userId: 'user-1' }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, removed: 1 })
    expect(db.table('user_push_subscriptions').map((r) => r.id)).toEqual(['b'])

    const again = await app.call('DELETE', '/v1/push/subscriptions', ctx({ body: { endpoint: SUB_FCM }, userId: 'user-1' }))
    expect(again.body).toEqual({ ok: true, removed: 0 })

    const invalid = await app.call('DELETE', '/v1/push/subscriptions', ctx({ body: {}, userId: 'user-1' }))
    expect(invalid.status).toBe(400)
  })
})

// ── POST /v1/push/test ───────────────────────────────────────────────────────

describe('POST /v1/push/test', () => {
  it('sends a test notification to the caller and reports counts', async () => {
    const { app, deps } = harness()
    const res = await app.call('POST', '/v1/push/test', ctx({ userId: 'user-9' }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, sent: 1, failed: 0 })
    expect(deps.sendWebPushToUser).toHaveBeenCalledWith(expect.anything(), 'user-9', expect.objectContaining({ title: 'Mushi Mushi', url: '/voice', tag: 'push-test' }))
    expect(deps.claimTenantRateLimit).toHaveBeenCalledWith(expect.anything(), 'user:user-9:push_test', 5, 60)
  })

  it('returns 429 with Retry-After when the per-user limit is hit', async () => {
    const { app, deps } = harness({ claimTenantRateLimit: vi.fn(async () => ({ allowed: false, retryAfterSec: 42 })) })
    const res = await app.call('POST', '/v1/push/test', ctx())
    expect(res.status).toBe(429)
    expect(res.headers['Retry-After']).toBe('42')
    expect(res.body).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retry_after_sec: 42 } })
    expect(deps.sendWebPushToUser).not.toHaveBeenCalled()
  })

  it('maps sender outcomes to 503 / 404 / 502', async () => {
    const notConfigured = harness({ sendWebPushToUser: vi.fn(async () => ({ sent: 0, failed: 0, error: 'push_not_configured' })) })
    expect((await notConfigured.app.call('POST', '/v1/push/test', ctx())).status).toBe(503)

    const none = harness({ sendWebPushToUser: vi.fn(async () => ({ sent: 0, failed: 0, error: 'no_subscriptions' })) })
    const noneRes = await none.app.call('POST', '/v1/push/test', ctx())
    expect(noneRes.status).toBe(404)
    expect(noneRes.body).toMatchObject({ error: { code: 'NOT_FOUND' } })

    const refused = harness({ sendWebPushToUser: vi.fn(async () => ({ sent: 0, failed: 2 })) })
    const refusedRes = await refused.app.call('POST', '/v1/push/test', ctx())
    expect(refusedRes.status).toBe(502)
    expect(refusedRes.body).toMatchObject({ error: { code: 'UPSTREAM_ERROR', sent: 0, failed: 2 } })
  })
})
