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
import { proxyToFunction } from '../../supabase/functions/_shared/edge-proxy.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  firecrawl: { key: 'fc-self', source: 'byok' } as null | { key: string; source: string },
  tasks: [] as Promise<unknown>[],
  emails: [] as Array<{ to: string; subject: string; text?: string; html?: string }>,
  events: [] as Array<{ eventName: string; properties?: Record<string, unknown> }>,
  runs: [] as string[],
  emailOk: true,
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
  sendTransactionalEmail: async (mail: { to: string; subject: string; text?: string; html?: string }) => {
    state.emails.push(mail)
    return state.emailOk ? { ok: true, id: 'em_1' } : { ok: false, reason: 'no_sender', error: 'RESEND_FROM_EMAIL not configured' }
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
        summary: { pages: [], headers: {}, https: 'ok', linksChecked: 0, scriptsChecked: 0, scriptsWithSourceMaps: 0, rendered: true, incomplete: [] },
      }
    },
  }
})

import {
  CHECKS_PER_DAY,
  CHECKS_PER_IP_PER_HOUR,
  RUNNING_STALE_MS,
  EMAIL_MAX_FINDINGS,
  buildReportEmail,
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
  state.emailOk = true
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
    expect(state.emails[0].text).toContain('1 to fix first, 1 to fix soon.')
    expect(state.emails[0].subject).toBe('acme.app: 2 things to fix (Production Check)')
    // The HTML twin carries the same report link as a button, and no image (no tracking pixel).
    expect(state.emails[0].html).toContain(`href="https://kensaur.us/mushi-mushi/docs/check?id=${data.id}"`)
    expect(state.emails[0].html).toContain('Open the full report')
    expect(state.emails[0].html).not.toMatch(/<img/i)
    const finished = state.events.find((e) => e.eventName === 'production_check_finished')
    expect(finished?.properties).toMatchObject({ project_id: SELF, outcome: 'done', rendered: true, high: 1, medium: 1, low: 0, src: 'reddit' })
    for (const e of state.events) {
      const json = JSON.stringify(e.properties)
      expect(json).not.toContain('acme.app')
      expect(json).not.toContain('@')
    }
  })

  it('a failed send clears the address but records no send', async () => {
    state.emailOk = false
    await post({ url: 'https://acme.app', email: 'founder@acme.app' })
    await Promise.all(state.tasks)
    const row = db.table('production_checks')[0] as Row
    expect(row.email).toBeNull()
    expect(row.email_sent_at).toBeNull()
  })

  it('a site checked today: the report is emailed once more, on the visitor\'s hourly budget', async () => {
    const id = '44444444-4444-4444-8444-444444444444'
    db.table('production_checks').push({ id, origin: 'https://acme.app', url: 'https://acme.app/', status: 'done', findings: [{ rule: 'missing_csp', severity: 'medium', title: 't', why: 'w', fix: 'f' }], summary: {}, created_at: new Date().toISOString() })
    const res = await post({ url: 'https://acme.app', email: 'second@acme.app' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: Record<string, unknown> }).data).toMatchObject({ id, cached: true, emailed: true })
    await Promise.all(state.tasks)
    expect(state.emails.map((e) => e.to)).toEqual(['second@acme.app'])
    expect(state.emails[0].text).toContain(`check?id=${id}`)
    expect(claims().map((c) => c.args.p_scope)).toEqual(['production_check_ip'])
    // The address is never written to the stored row.
    expect(db.table('production_checks')[0].email).toBeUndefined()

    // Over the hourly budget: the report still comes back, no email.
    for (let i = 0; i < CHECKS_PER_IP_PER_HOUR; i++) await post({ url: 'https://acme.app', email: 'x@acme.app' })
    expect(state.emails.length).toBe(CHECKS_PER_IP_PER_HOUR)
    const over = (await (await post({ url: 'https://acme.app', email: 'x@acme.app' })).json()) as { data: Record<string, unknown> }
    expect(over.data).toMatchObject({ id, cached: true, emailed: false })
  })

  it('a site whose check is still running: no email, and the address is not stored', async () => {
    db.table('production_checks').push({ id: '55555555-5555-4555-8555-555555555555', origin: 'https://acme.app', url: 'https://acme.app/', status: 'running', findings: [], summary: {}, created_at: new Date().toISOString() })
    const body = (await (await post({ url: 'https://acme.app', email: 'third@acme.app' })).json()) as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({ cached: true, emailed: false })
    expect(state.emails).toHaveLength(0)
    expect(claims()).toHaveLength(0)
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
  const h = (m: Record<string, string>) => (n: string) => m[n]

  it('prefers Cloudflare, then the rightmost forwarded hop', async () => {
    expect(await callerIp(h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }), 'k')).toBe('1.1.1.1')
    expect(await callerIp(h({ 'x-forwarded-for': 'spoofed, 3.3.3.3' }), 'k')).toBe('3.3.3.3')
    expect(await callerIp(h({}), 'k')).toBe('unknown')
  })

  it('behind the api → api-ext hop, visitors are told apart by the IP api signed', async () => {
    // api-ext's own Cloudflare header is api's egress address for every visitor.
    const forward = async (visitor: string) => {
      let sent: Headers | undefined
      await proxyToFunction(new Request('https://ref.supabase.co/functions/v1/api/v1/public/production-check', { method: 'POST', headers: { 'cf-connecting-ip': visitor }, body: '{}' }), 'api-ext', '/v1/public/production-check', {
        supabaseUrl: 'https://ref.supabase.co',
        clientIpSecret: 'service-secret',
        fetchImpl: (async (_u: string, init: RequestInit) => {
          sent = init.headers as Headers
          return new Response('{}')
        }) as unknown as typeof fetch,
      })
      return { ...Object.fromEntries(sent!.entries()), 'cf-connecting-ip': '34.1.1.1' }
    }
    for (let i = 0; i < CHECKS_PER_IP_PER_HOUR; i++) {
      expect((await post({ url: `https://v${i}.app` }, await forward('198.51.100.1'))).status).toBe(202)
    }
    expect((await post({ url: 'https://v9.app' }, await forward('198.51.100.1'))).status).toBe(429)
    expect((await post({ url: 'https://v9.app' }, await forward('198.51.100.2'))).status).toBe(202)
  })

  it('a forged client-IP header is ignored', async () => {
    const forged = h({ 'x-mushi-client-ip': '9.9.9.9', 'x-mushi-client-ip-sig': 'a'.repeat(64), 'cf-connecting-ip': '5.5.5.5' })
    expect(await callerIp(forged, 'service-secret')).toBe('5.5.5.5')
  })
})

describe('buildReportEmail', () => {
  const finding = (severity: 'high' | 'medium' | 'low', title: string) => ({ rule: 'r', severity, title, why: 'w', fix: `fix ${title}` })

  it('shows the worst findings first, at most EMAIL_MAX_FINDINGS, and says how many more', () => {
    const findings = [
      finding('low', 'L1'), finding('medium', 'M1'), finding('high', 'H1'), finding('low', 'L2'),
      finding('medium', 'M2'), finding('low', 'L3'), finding('high', 'H2'),
    ]
    const mail = buildReportEmail('shop.app', 'id-1', { findings })
    expect(mail.subject).toBe('shop.app: 7 things to fix (Production Check)')
    const order = ['H1', 'H2', 'M1', 'M2', 'L1'].map((t) => mail.text.indexOf(`] ${t}`))
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true)
    expect(mail.text).not.toContain('] L3')
    expect(EMAIL_MAX_FINDINGS).toBe(5)
    expect(mail.text).toContain('And 2 more in the full report.')
    expect(mail.text).toContain('How to fix: fix H1')
    expect(mail.html).toContain('Fix first')
  })

  it('a clean site lists what passed, from the stored summary', () => {
    const mail = buildReportEmail('ok.app', 'id-2', {
      findings: [],
      summary: {
        pages: [{ path: '/', status: 200 }, { path: '/docs', status: 200 }, { path: '/a', status: 200 }],
        headers: { 'content-security-policy': true, 'strict-transport-security': true, 'x-content-type-options': true, 'referrer-policy': true },
        https: 'ok', linksChecked: 20, scriptsChecked: 3, scriptsWithSourceMaps: 0, rendered: true, incomplete: [],
      },
    })
    expect(mail.subject).toBe('ok.app passed the Production Check')
    expect(mail.text).toContain('- 3 pages of 3 opened without an error')
    expect(mail.text).toContain('- All 4 security headers are sent')
    expect(mail.text).toContain('- 20 links checked, none broken')
    expect(mail.text).toContain('- No source maps published')
  })

  it('escapes what a site controls (finding titles) in the HTML', () => {
    const mail = buildReportEmail('x.app', 'id-3', { findings: [finding('high', '<script>alert(1)</script>')] })
    expect(mail.html).not.toContain('<script>alert(1)')
    expect(mail.html).toContain('&lt;script&gt;')
  })
})
