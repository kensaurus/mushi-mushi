/**
 * FILE: kensaurus-ops-routes.test.ts
 * PURPOSE: The operator proxy to kensaurus-ops (api/routes/kensaurus-ops.ts)
 *          on a real Hono app with fetch, env and the operator gate injected:
 *            - 404 when unconfigured, 403 for a non-operator;
 *            - GET proxies, holds the snapshot 60 s, ?fresh=1 skips the hold;
 *            - POST sets actor from the JWT user and drops the client's;
 *            - an unknown action is 400 and never reaches upstream;
 *            - 409 / 422 / validation_failed pass through as the console envelope;
 *            - upstream 401 → 502 upstream_auth, 503 → 503 not_configured;
 *            - a successful write clears the hold;
 *            - the token never appears in a response or a log call.
 */
import { Hono } from 'hono'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const logged = vi.hoisted(() => [] as unknown[][])
const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) {
    logger[level] = (...args: unknown[]) => {
      logged.push(args)
    }
  }
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))

let mod: typeof import('../../supabase/functions/api/routes/kensaurus-ops.ts')
beforeAll(async () => {
  mod = await import('../../supabase/functions/api/routes/kensaurus-ops.ts')
})

const OPERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TOKEN = 'fixture-console-token-value' // check-no-secrets: ignore-line — test fixture, not a credential
const URL_ = 'https://kenji.example.supabase.co/functions/v1/kensaurus-ops'
const SNAPSHOT = { ok: true, meta: { version: 1 }, snapshot: { generated_at: '2026-11-18T12:00:00Z', providers: [] } }

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

interface Harness {
  app: Hono
  calls: Call[]
  clock: { now: number }
  answer: { status: number; body: unknown }
  as: (userId: string) => void
}

function harness(env: Record<string, string> = { KENSAURUS_OPS_URL: URL_, KENSAURUS_OPS_CONSOLE_TOKEN: TOKEN }): Harness {
  const calls: Call[] = []
  const clock = { now: Date.parse('2026-11-18T12:00:00Z') }
  const answer = { status: 200, body: SNAPSHOT as unknown }
  let user = OPERATOR
  const app = new Hono()
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  mod.registerKensaurusOpsRoutes(app as never, {
    jwtAuth: (async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('userId', user)
      await next()
    }) as never,
    requireOperator: (c) =>
      c.get('userId') === OPERATOR ? null : (c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'operator only' } }, 403) as Response),
    env: (name) => env[name],
    fetchImpl,
    now: () => clock.now,
  })
  return { app, calls, clock, answer, as: (id) => (user = id) }
}

const get = (h: Harness, q = '') => h.app.request(`/v1/admin/kensaurus/ops${q}`)
const post = (h: Harness, body: unknown) =>
  h.app.request('/v1/admin/kensaurus/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  logged.length = 0
})

describe('kensaurus ops proxy: gates', () => {
  it('answers 404 when the URL or the token is unset, and never calls upstream', async () => {
    for (const env of [{}, { KENSAURUS_OPS_URL: URL_ }, { KENSAURUS_OPS_CONSOLE_TOKEN: TOKEN }]) {
      const h = harness(env)
      expect((await get(h)).status).toBe(404)
      expect((await post(h, { action: 'enable_route' })).status).toBe(404)
      expect(h.calls).toHaveLength(0)
    }
  })

  it('answers 403 to a signed-in user who is not an operator', async () => {
    const h = harness()
    h.as(OTHER)
    expect((await get(h)).status).toBe(403)
    expect((await post(h, { action: 'enable_route', app: 'yen-yen', feature: '*', priority: 1 })).status).toBe(403)
    expect(h.calls).toHaveLength(0)
  })
})

describe('kensaurus ops proxy: GET', () => {
  it('proxies with the token header and holds the snapshot for 60 s', async () => {
    const h = harness()
    const first = await get(h)
    expect(first.status).toBe(200)
    const body = (await first.json()) as { ok: boolean; data: { snapshot: unknown; meta: unknown; cached: boolean } }
    expect(body.ok).toBe(true)
    expect(body.data.snapshot).toEqual(SNAPSHOT.snapshot)
    expect(body.data.meta).toEqual(SNAPSHOT.meta)
    expect(body.data.cached).toBe(false)
    expect(h.calls[0]).toMatchObject({ url: URL_, method: 'GET' })
    expect(h.calls[0].headers['x-kensaurus-ops-token']).toBe(TOKEN)

    h.clock.now += 59_000
    const second = (await (await get(h)).json()) as { data: { cached: boolean } }
    expect(second.data.cached).toBe(true)
    expect(h.calls).toHaveLength(1)

    h.clock.now += 2_000
    await get(h)
    expect(h.calls).toHaveLength(2)
  })

  it('skips the hold with ?fresh=1', async () => {
    const h = harness()
    await get(h)
    await get(h, '?fresh=1')
    expect(h.calls).toHaveLength(2)
  })

  it('maps upstream 401 to 502 upstream_auth and 503 to not_configured, and holds neither', async () => {
    const h = harness()
    h.answer.status = 401
    h.answer.body = { error: 'unauthorized' }
    const res = await get(h)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('upstream_auth')
    h.answer.status = 503
    h.answer.body = { error: 'not_configured' }
    const res2 = await get(h)
    expect(res2.status).toBe(503)
    expect(((await res2.json()) as { error: { code: string } }).error.code).toBe('not_configured')
    expect(h.calls).toHaveLength(2)
  })
})

describe('kensaurus ops proxy: POST', () => {
  it('sets actor from the JWT user and drops the client actor', async () => {
    const h = harness()
    h.answer.body = { ok: true, action: 'disable_route', result: { app: 'yen-yen', priority: 2 } }
    const res = await post(h, { action: 'disable_route', app: 'yen-yen', feature: '*', priority: 2, actor: 'console:someone-else' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { action: 'disable_route', result: { app: 'yen-yen', priority: 2 } } })
    expect(h.calls[0].method).toBe('POST')
    expect(h.calls[0].body).toEqual({ action: 'disable_route', app: 'yen-yen', feature: '*', priority: 2, actor: `console:${OPERATOR}` })
  })

  it('refuses an unknown action or a non-object body with 400 before upstream', async () => {
    const h = harness()
    const res = await post(h, { action: 'drop_everything' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_failed')
    expect((await post(h, ['reorder'])).status).toBe(400)
    const bad = await h.app.request('/v1/admin/kensaurus/ops', { method: 'POST', body: '{nope' })
    expect(bad.status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('refuses a body over 16 KB with 413', async () => {
    const h = harness()
    const res = await post(h, { action: 'upsert_route', note: 'x'.repeat(17_000) })
    expect(res.status).toBe(413)
    expect(h.calls).toHaveLength(0)
  })

  it('passes a batch through with the actor set, and lets only a batch go past 16 KB, up to 64 KB', async () => {
    const h = harness()
    h.answer.body = { ok: true, action: 'batch', result: { applied: 2, features: 2 } }
    const op = (feature: string) => ({ action: 'upsert_route', app: 'glot-it', feature, priority: 1, provider: 'openai', model: 'gpt-6.1-terra' })
    const batch = { action: 'batch', app: 'glot-it', ops: [op('*'), op('story')], expect: [{ feature: '*', count: 3, updated_at: null }], actor: 'console:x' }
    const res = await post(h, batch)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { action: 'batch', result: { applied: 2, features: 2 } } })
    expect(h.calls[0].body).toEqual({ ...batch, actor: `console:${OPERATOR}` })
    // ~20 KB: fine for a batch, too large for anything else.
    const big = { ...batch, ops: Array.from({ length: 160 }, (_, i) => op(`feature-${i}`)) }
    expect(JSON.stringify(big).length).toBeGreaterThan(16 * 1024)
    expect((await post(h, big)).status).toBe(200)
    expect((await post(h, { ...big, action: 'upsert_route' })).status).toBe(413)
    const huge = await post(h, { ...batch, note: 'x'.repeat(65 * 1024) })
    expect(huge.status).toBe(413)
    expect(h.calls).toHaveLength(2)
  })

  it('passes 409 last_default_route and 422 unpriced_model through with their message', async () => {
    const h = harness()
    h.answer.status = 409
    h.answer.body = { error: 'last_default_route', message: 'yen-yen would have no enabled default route' }
    const res = await post(h, { action: 'disable_route', app: 'yen-yen', feature: '*', priority: 1 })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'last_default_route', message: 'yen-yen would have no enabled default route' },
    })
    h.answer.status = 422
    h.answer.body = { error: 'unpriced_model', message: 'no price' }
    const res2 = await post(h, { action: 'upsert_route', app: 'yen-yen', feature: '*', priority: 1, provider: 'openai', model: 'gpt-x' })
    expect(res2.status).toBe(422)
    expect(((await res2.json()) as { error: { code: string } }).error.code).toBe('unpriced_model')
  })

  it('passes validation_failed details through as issues', async () => {
    const h = harness()
    h.answer.status = 400
    h.answer.body = { error: 'validation_failed', details: ['params.effort: unrecognized_keys'] }
    const res = await post(h, { action: 'upsert_route', app: 'yen-yen', feature: '*', priority: 1, provider: 'anthropic', model: 'claude-x', params: { effort: 'high' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'validation_failed', message: 'validation_failed', issues: ['params.effort: unrecognized_keys'] },
    })
  })

  it('clears the held snapshot after a successful write, not after a refused one', async () => {
    const h = harness()
    await get(h)
    h.answer.status = 409
    h.answer.body = { error: 'last_default_route' }
    await post(h, { action: 'disable_route', app: 'yen-yen', feature: '*', priority: 1 })
    h.answer.status = 200
    h.answer.body = SNAPSHOT
    await get(h)
    expect(h.calls.filter((c) => c.method === 'GET')).toHaveLength(1)

    h.answer.body = { ok: true, action: 'enable_route', result: {} }
    await post(h, { action: 'enable_route', app: 'yen-yen', feature: '*', priority: 2 })
    h.answer.body = SNAPSHOT
    await get(h)
    expect(h.calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  })

  it('never returns or logs the token', async () => {
    const h = harness()
    const texts: string[] = []
    texts.push(await (await get(h, '?fresh=1')).text())
    h.answer.status = 401
    h.answer.body = { error: 'unauthorized' }
    texts.push(await (await get(h, '?fresh=1')).text())
    h.answer.status = 500
    h.answer.body = { error: 'query_failed' }
    texts.push(await (await post(h, { action: 'enable_route', app: 'a', feature: '*', priority: 1 })).text())
    // A network failure is logged by error name only.
    const broken = harness()
    ;(broken as unknown as { app: Hono }).app = new Hono()
    mod.registerKensaurusOpsRoutes(broken.app as never, {
      jwtAuth: (async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
        c.set('userId', OPERATOR)
        await next()
      }) as never,
      requireOperator: () => null,
      env: (name) => ({ KENSAURUS_OPS_URL: URL_, KENSAURUS_OPS_CONSOLE_TOKEN: TOKEN })[name],
      fetchImpl: (async () => {
        throw new TypeError(`connect failed with ${TOKEN}`)
      }) as unknown as typeof fetch,
      now: () => 0,
    })
    const down = await get(broken)
    expect(down.status).toBe(502)
    texts.push(await down.text())
    for (const t of texts) expect(t).not.toContain(TOKEN)
    expect(logged.length).toBeGreaterThan(0)
    expect(JSON.stringify(logged)).not.toContain(TOKEN)
  })
})
