/**
 * FILE: production-check-routes.test.ts
 * PURPOSE: The free Production Check routes (api/routes/production-check.ts,
 *          served by api-ext) on an in-memory database:
 *            - a private or local address is refused before anything is
 *              spent (no rate-limit claim, no row);
 *            - no Firecrawl key on Mushi's own project → 503, nothing spent;
 *            - one check per origin per 24 h: a repeat gets the same report
 *              id and spends no IP or daily budget;
 *            - 5 new checks per IP per hour (429), the IP taken from Cloudflare
 *              or the rightmost X-Forwarded-For hop, stored only as a hash;
 *            - 100 a day overall (429); a failed claim refuses (fail closed);
 *            - the background run stores findings, sends one email with the
 *              report link and clears the address; events carry no URL,
 *              origin or email;
 *            - GET never returns the email, IP hash or src, and a check whose
 *              run died reads as failed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'npm:hono@4'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  firecrawl: { key: 'fc-self', source: 'byok' } as null | { key: string; source: string },
  tasks: [] as Promise<unknown>[],
  emails: [] as Array<{ to: string; subject: string; text?: string }>,
  events: [] as Array<{ eventName: string; properties?: Record<string, unknown> }>,
  runs: [] as string[],
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({
  runInBackground: (p: Promise<unknown>) => {
    state.tasks.push(p)
  },
  keepAlive: <T>(p: Promise<T>) => p,
}))
vi.mock('../../supabase/functions/_shared/firecrawl.ts', () => ({ resolveFirecrawl: async () => state.firecrawl }))
vi.mock('../../supabase/functions/_shared/product-events.ts', () => ({
  emitProductEvent: async (_db: unknown, payload: { eventName: string; properties?: Record<string, unknown> }) => {
    state.events.push(payload)
    return true
  },
}))
vi.mock('../../supabase/functions/_shared/email.ts', () => ({
  sendTransactionalEmail: async (mail: { to: string; subject: string; text?: string }) => {
    state.emails.push(mail)
    return { ok: true, id: 'em_1' }
  },
}))
vi.mock('../../supabase/functions/_shared/production-check.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supabase/functions/_shared/production-check.ts')>()
  return {
    ...actual,
    runProductionCheck: async (url: string) => {
      state.runs.push(url)
      return {
        findings: [
          { rule: 'missing_csp', severity: 'medium', title: 'No Content-Security-Policy header', why: 'w', fix: 'f' },
          { rule: 'page_error_status', severity: 'high', title: '1 page answers with an error code', why: 'w', fix: 'f', where: ['/x (500)'] },
        ],
        summary: { pages: [], headers: {}, https: 'ok', linksChecked: 0, scriptsChecked: 0, scriptsWithSourceMaps: 0, incomplete: [] },
      }
    },
  }
})

import {
  CHECKS_PER_DAY,
  CHECKS_PER_IP_PER_HOUR,
  RUNNING_STALE_MS,
  callerIp,
  registerProductionCheckRoutes,
} from '../../supabase/functions/api/routes/production-check.ts'

const SELF = '99999999-9999-4999-8999-999999999999'
let db: FakeDb
let claimFails = false
let globalUsed = 0
const counts = new Map<string, number>()

function installRpc(fake: FakeDb) {
  ;(fake as unknown as { rpc: FakeDb['rpc'] }).rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    fake.rpcCalls.push({ fn, args })
    if (fn === 'scoped_rate_limit_claim') {
      if (claimFails) return { data: null, error: { code: 'XX000', message: 'connection reset' } }
      const key = `${args.p_scope}|${args.p_user_id}`
      const n = (counts.get(key) ?? (args.p_scope === 'production_check_global' ? globalUsed : 0)) + 1
      counts.set(key, n)
      if (n > Number(args.p_max_per_window)) return { data: null, error: { code: 'P0001', message: `rate_limit_exceeded: scope=${args.p_scope}` } }
      return { data: n, error: null }
    }
    if (fn === 'production_check_begin') {
      // The SQL function's contract: the origin's fresh check, else a new row.
      const rows = fake.table('production_checks')
      const fresh = rows.find((r) => r.origin === args.p_origin && (r.status === 'done' || r.status === 'running'))
      if (fresh) return { data: [{ check_id: fresh.id, cached: true }], error: null }
      const id = crypto.randomUUID()
      rows.push({ id, origin: args.p_origin, url: args.p_url, ip_hash: args.p_ip_hash, email: args.p_email, src: args.p_src, status: 'running', findings: [], summary: {}, created_at: new Date().toISOString() })
      return { data: [{ check_id: id, cached: false }], error: null }
    }
    return { data: null, error: { code: 'PGRST202', message: `no function ${fn}` } }
  }
}

function app() {
  const a = new Hono()
  registerProductionCheckRoutes(a as never)
  return a
}

function post(body: Record<string, unknown>, headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.9' }) {
  return app().request('/v1/public/production-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  db = makeFakeDb({ production_checks: [] })
  installRpc(db)
  state.db = db
  state.firecrawl = { key: 'fc-self', source: 'byok' }
  state.tasks = []
  state.emails = []
  state.events = []
  state.runs = []
  claimFails = false
  globalUsed = 0
  counts.clear()
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (k: string) => ({ MUSHI_SELF_PROJECT_ID: SELF, SUPABASE_SERVICE_ROLE_KEY: 'service-secret' } as Record<string, string>)[k] },
  }
})

const claims = () => db.rpcCalls.filter((c) => c.fn === 'scoped_rate_limit_claim')

describe('POST /v1/public/production-check', () => {
  it.each(['http://localhost:3000', 'http://10.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'https://db.internal/'])(
    'refuses %s before spending anything',
    async (url) => {
      const res = await post({ url })
      expect(res.status).toBe(400)
      expect(db.rpcCalls).toHaveLength(0)
      expect(db.table('production_checks')).toHaveLength(0)
    },
  )

  it('503 without a Firecrawl key on Mushi\'s own project, nothing spent', async () => {
    state.firecrawl = null
    const res = await post({ url: 'https://acme.app' })
    expect(res.status).toBe(503)
    expect(claims()).toHaveLength(0)
  })

  it('runs a new check, then hands the same report back for 24 h without spending budget', async () => {
    const first = await post({ url: 'https://acme.app/pricing', email: 'Founder@Acme.app', src: 'hn' })
    expect(first.status).toBe(202)
    const a = (await first.json()) as { data: { id: string; cached: boolean } }
    expect(a.data.cached).toBe(false)
    const begin = db.rpcCalls.find((c) => c.fn === 'production_check_begin')!.args
    expect(begin).toMatchObject({ p_origin: 'https://acme.app', p_url: 'https://acme.app/pricing', p_email: 'founder@acme.app', p_src: 'hn' })
    expect(String(begin.p_ip_hash)).toMatch(/^[0-9a-f]{64}$/)
    expect(String(begin.p_ip_hash)).not.toContain('203.0.113.9')
    expect(state.events[0]).toMatchObject({ eventName: 'production_check_started', properties: { project_id: SELF, src: 'hn' } })

    const spent = claims().length
    const again = await post({ url: 'acme.app' }, { 'cf-connecting-ip': '198.51.100.20' })
    expect(again.status).toBe(200)
    const b = (await again.json()) as { data: { id: string; cached: boolean } }
    expect(b.data).toMatchObject({ id: a.data.id, cached: true })
    expect(claims()).toHaveLength(spent)
    expect(db.table('production_checks')).toHaveLength(1)
  })

  it(`allows ${CHECKS_PER_IP_PER_HOUR} new checks per IP per hour`, async () => {
    for (let i = 0; i < CHECKS_PER_IP_PER_HOUR; i++) {
      expect((await post({ url: `https://site${i}.app` })).status).toBe(202)
    }
    const limited = await post({ url: 'https://one-more.app' })
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
    expect(db.table('production_checks')).toHaveLength(CHECKS_PER_IP_PER_HOUR)
    // Another visitor still can.
    expect((await post({ url: 'https://one-more.app' }, { 'cf-connecting-ip': '198.51.100.7' })).status).toBe(202)
  })

  it('a spoofed left X-Forwarded-For hop does not dodge the per-IP limit', async () => {
    for (let i = 0; i < CHECKS_PER_IP_PER_HOUR; i++) {
      await post({ url: `https://x${i}.app` }, { 'x-forwarded-for': `10.0.0.${i}, 192.0.2.44` })
    }
    const res = await post({ url: 'https://x9.app' }, { 'x-forwarded-for': '10.9.9.9, 192.0.2.44' })
    expect(res.status).toBe(429)
  })

  it(`stops at ${CHECKS_PER_DAY} checks a day overall`, async () => {
    globalUsed = CHECKS_PER_DAY
    const res = await post({ url: 'https://acme.app' })
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DAILY_LIMIT')
    expect(db.table('production_checks')).toHaveLength(0)
  })

  it('refuses when the rate-limit claim itself fails (fail closed)', async () => {
    claimFails = true
    const res = await post({ url: 'https://acme.app' })
    expect(res.status).toBe(503)
    expect(db.table('production_checks')).toHaveLength(0)
    expect(state.runs).toHaveLength(0)
  })

  it('refuses a malformed email instead of storing it', async () => {
    const res = await post({ url: 'https://acme.app', email: 'not an email' })
    expect(res.status).toBe(400)
    expect(db.table('production_checks')).toHaveLength(0)
  })

  it('the run stores findings, sends one email and forgets the address', async () => {
    const res = await post({ url: 'https://acme.app', email: 'founder@acme.app', src: 'reddit' })
    const { data } = (await res.json()) as { data: { id: string } }
    await Promise.all(state.tasks)
    const row = db.table('production_checks')[0] as Row
    expect(row.status).toBe('done')
    expect((row.findings as unknown[]).length).toBe(2)
    expect(row.email).toBeNull()
    expect(row.email_sent_at).toBeTruthy()
    expect(state.emails).toHaveLength(1)
    expect(state.emails[0].to).toBe('founder@acme.app')
    expect(state.emails[0].text).toContain(`https://kensaur.us/mushi-mushi/docs/check?id=${data.id}`)
    expect(state.emails[0].text).toContain('1 to fix first, 1 to fix soon, 0 nice to fix')
    const finished = state.events.find((e) => e.eventName === 'production_check_finished')
    expect(finished?.properties).toMatchObject({ project_id: SELF, outcome: 'done', high: 1, medium: 1, low: 0, src: 'reddit' })
    for (const e of state.events) {
      const json = JSON.stringify(e.properties)
      expect(json).not.toContain('acme.app')
      expect(json).not.toContain('@')
    }
  })
})

describe('GET /v1/public/production-check/:id', () => {
  it('returns the report without the email, IP hash or src', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    db.table('production_checks').push({ id, origin: 'https://acme.app', url: 'https://acme.app/', status: 'done', findings: [], summary: {}, email: 'a@b.co', ip_hash: 'h', src: 'hn', created_at: new Date().toISOString() })
    const res = await app().request(`/v1/public/production-check/${id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data.status).toBe('done')
    expect(body.data).not.toHaveProperty('email')
    expect(body.data).not.toHaveProperty('ip_hash')
    expect(body.data).not.toHaveProperty('src')
  })

  it('404 for an unknown or malformed id', async () => {
    expect((await app().request('/v1/public/production-check/22222222-2222-4222-8222-222222222222')).status).toBe(404)
    expect((await app().request('/v1/public/production-check/not-a-uuid')).status).toBe(404)
  })

  it('a check whose run died reads as failed', async () => {
    const id = '33333333-3333-4333-8333-333333333333'
    db.table('production_checks').push({ id, origin: 'https://acme.app', url: 'https://acme.app/', status: 'running', findings: [], summary: {}, created_at: new Date(Date.now() - RUNNING_STALE_MS - 1000).toISOString() })
    const body = (await (await app().request(`/v1/public/production-check/${id}`)).json()) as { data: { status: string } }
    expect(body.data.status).toBe('failed')
    expect(db.table('production_checks')[0].status).toBe('failed')
  })
})

describe('callerIp', () => {
  it('prefers Cloudflare, then the rightmost forwarded hop', () => {
    const h = (m: Record<string, string>) => (n: string) => m[n]
    expect(callerIp(h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1')
    expect(callerIp(h({ 'x-forwarded-for': 'spoofed, 3.3.3.3' }))).toBe('3.3.3.3')
    expect(callerIp(h({}))).toBe('unknown')
  })
})
