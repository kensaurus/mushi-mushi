/**
 * FILE: ops-routes.test.ts
 * PURPOSE: The Ops hub routes (api/routes/ops.ts) through a real Hono app on
 *          the in-memory database, Slack stubbed:
 *            - POST /v1/ops/events: zod bounds, https only, 422 PII_REJECTED,
 *              202 then delivery, a repeated dedupe_key answers 200, the rate
 *              limit fails closed (503 when it cannot be checked);
 *            - the console routes: org members only, viewers cannot ack,
 *              settings never return a secret, only owners and admins save;
 *              coverage answers per app and category, today's counts;
 *            - the ops key: exactly ['ops:write'], label ops:<slug>;
 *            - Slack: signed with the org's own secret found by team_id (a
 *              fixture signature passes, a forged one is 401, a stale one is
 *              401), help answers inline, data commands answer through
 *              response_url, buttons only touch their own org's events.
 *          The ops:write scope gate itself runs on the real middleware in
 *          ops-scope.test.ts.
 */
import { Hono } from 'hono'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { computeSlackSignature, verifySlackRequest } from '../../supabase/functions/_shared/slack-verify.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  getOrgIdFromContext: () => null,
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', () => ({
  claimTenantRateLimit: async () => ({ allowed: true }),
  claimTenantRateLimitStrict: async () => ({ allowed: true }),
  logOrgAudit: async () => {},
}))
vi.mock('../../supabase/functions/_shared/webhook-middleware.ts', () => {
  class ReplayAttackError extends Error {}
  class RateLimitError extends Error {}
  return { createWebhookMiddleware: () => ({}), ReplayAttackError, RateLimitError }
})
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400, extra?: Record<string, unknown>) =>
    c.json({ ok: false, error: { code, message, ...extra } }, status),
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

let ops: typeof import('../../supabase/functions/api/routes/ops.ts')
beforeAll(async () => {
  ops = await import('../../supabase/functions/api/routes/ops.ts')
})

const NOW = new Date('2026-11-17T05:00:00Z')
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const P1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const P2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OWNER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const VIEWER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const SIGNING = '0123456789abcdef0123456789abcdef'
const VAULT: Record<string, string> = { 'vault-bot': 'xoxb-test-token', 'vault-sign': SIGNING } // check-no-secrets: ignore-line — literal fixtures, not credentials

interface Harness {
  app: Hono
  db: FakeDb
  slack: Array<{ url: string; body: Record<string, any> }>
  background: Promise<unknown>[]
  rate: { strict: { allowed: boolean; unavailable?: boolean; retryAfterSec?: number } }
  minted: Array<Record<string, unknown>>
}

function harness(seed: Record<string, Array<Record<string, unknown>>> = {}): Harness {
  const db = makeFakeDb(
    {
      projects: [
        { id: P1, organization_id: ORG, name: 'Glot.it', slug: 'glot-it', icon_url: null },
        { id: P2, organization_id: ORG, name: 'yen-yen', slug: 'yen-yen', icon_url: null },
      ],
      organization_members: [
        { organization_id: ORG, user_id: OWNER, role: 'owner' },
        { organization_id: ORG, user_id: VIEWER, role: 'viewer' },
      ],
      ops_slack_settings: [
        { organization_id: ORG, enabled: true, team_id: 'T0TEAM', bot_user_id: 'U0BOT', bot_token_secret_id: 'vault-bot', signing_secret_id: 'vault-sign', channel_payments: 'C0PAY', channel_releases: 'C0REL', channel_alerts: 'C0ALR', command: '/kensaurus', icon_base_url: null },
        { organization_id: OTHER_ORG, enabled: true, team_id: 'T0OTHER', bot_token_secret_id: null, signing_secret_id: 'vault-sign', command: '/other' },
      ],
      ...seed,
    },
    {
      autoId: true,
      partialUniques: { ops_events: { keys: ['organization_id', 'dedupe_key'], where: (r) => r.dedupe_key != null } },
      rpc: (fn, args) => {
        if (fn === 'vault_get_secret') return VAULT[String(args.secret_id)] ?? null
        if (fn === 'vault_store_secret') return `vault-${String(args.secret_name).split('/').pop()}`
        if (fn === 'ops_coverage') return [{ project_id: P1, category: 'payments', last_at: '2026-11-17T04:00:00Z', count_7d: '3' }]
        return null
      },
    },
  )
  const slack: Harness['slack'] = []
  const background: Promise<unknown>[] = []
  const rate: Harness['rate'] = { strict: { allowed: true } }
  const minted: Array<Record<string, unknown>> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    slack.push({ url: String(url), body })
    if (String(url).endsWith('auth.test')) return new Response(JSON.stringify({ ok: true, team_id: 'T0TEAM', user_id: 'U0BOT' }))
    return new Response(JSON.stringify({ ok: true, ts: '200.0001' }))
  }) as typeof fetch

  const app = new Hono()
  const setVars = async (c: any, next: () => Promise<void>) => {
    const user = c.req.header('x-test-user')
    if (user) c.set('userId', user)
    const project = c.req.header('x-test-project')
    if (project) c.set('projectId', project)
    await next()
  }
  ops.registerOpsRoutes(app as never, {
    ...ops.defaultOpsRouteDeps,
    getServiceClient: () => db as never,
    apiKeyAuth: setVars as never,
    requireOpsScope: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    jwtAuth: setVars as never,
    claimRateLimitStrict: async () => rate.strict,
    claimRateLimit: async () => ({ allowed: true }),
    callerCanAccessProject: (async (_c: unknown, _db: unknown, userId: string) =>
      userId === OWNER ? { allowed: true, role: 'owner' } : userId === VIEWER ? { allowed: true, role: 'viewer' } : { allowed: false, role: null }) as never,
    mintKey: (async (_db: unknown, input: Record<string, unknown>) => {
      minted.push(input)
      return { ok: true, minted: { id: 'k1', key: 'mushi_plaintext', prefix: 'mushi_plain' } }
    }) as never,
    logAudit: (async () => {}) as never,
    logOrgAudit: (async () => {}) as never,
    verifySlack: verifySlackRequest,
    webhookMiddleware: () => ({ audit: async () => ({ id: 'a1', resolve: async () => {} }), checkReplay: async () => {}, checkRateLimit: () => {} }),
    runInBackground: (p) => void background.push(p),
    fetchImpl,
    now: () => NOW,
    adminBaseUrl: () => 'https://kensaur.us/admin',
    supabaseUrl: () => 'https://proj.supabase.co',
  })
  return { app, db, slack, background, rate, minted }
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const asProject = { 'x-test-project': P1 }

describe('POST /v1/ops/events', () => {
  const good = { category: 'payments', kind: 'payment.succeeded', title: 'New subscription', amount_minor: 1200, currency: 'JPY', facts: [{ label: 'Plan', value: 'Pro' }], dedupe_key: 'pi_1' }

  it('stores, answers 202, then delivers to Slack in the background', async () => {
    const h = harness()
    const res = await h.app.request('/v1/ops/events', json(good, asProject))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.data.status).toBe('created')
    await Promise.all(h.background)
    expect(h.db.table('ops_events')[0]).toMatchObject({ organization_id: ORG, project_id: P1, category: 'payments', amount_minor: 1200, slack_ts: '200.0001' })
    expect(h.slack[0].body).toMatchObject({ channel: 'C0PAY', text: 'glot.it · New subscription' })
  })

  it('answers 200 with the stored event for a repeated dedupe_key, and posts once', async () => {
    const h = harness()
    await h.app.request('/v1/ops/events', json(good, asProject))
    const again = await h.app.request('/v1/ops/events', json(good, asProject))
    expect(again.status).toBe(200)
    expect((await again.json()).data.status).toBe('duplicate')
    await Promise.all(h.background)
    expect(h.slack.filter((c) => c.url.endsWith('chat.postMessage'))).toHaveLength(1)
  })

  it('refuses bad bodies', async () => {
    const h = harness()
    const cases: Array<Record<string, unknown>> = [
      { ...good, category: 'misc' },
      { ...good, title: 'x'.repeat(151) },
      { ...good, body: 'x'.repeat(601) },
      { ...good, url: 'http://insecure.test' },
      { ...good, facts: Array.from({ length: 9 }, () => ({ label: 'a', value: 'b' })) },
      { ...good, currency: undefined },
      { ...good, kind: 'Payment Succeeded' },
      { ...good, extra: true },
    ]
    for (const body of cases) {
      const res = await h.app.request('/v1/ops/events', json(body, asProject))
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400)
    }
  })

  it('422 PII_REJECTED for an email or a phone number, naming the field', async () => {
    const h = harness()
    const res = await h.app.request('/v1/ops/events', json({ ...good, facts: [{ label: 'Customer', value: 'jane@example.com' }] }, asProject))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatchObject({ code: 'PII_REJECTED', field: 'facts[0].value' })
    const phone = await h.app.request('/v1/ops/events', json({ ...good, body: 'call 090-1234-5678' }, asProject))
    expect(phone.status).toBe(422)
    expect(h.db.table('ops_events')).toHaveLength(0)
  })

  it('the rate limit fails closed: 429 over the limit, 503 when it cannot be checked', async () => {
    const h = harness()
    h.rate.strict = { allowed: false, retryAfterSec: 30 }
    expect((await h.app.request('/v1/ops/events', json(good, asProject))).status).toBe(429)
    h.rate.strict = { allowed: false, unavailable: true, retryAfterSec: 30 }
    expect((await h.app.request('/v1/ops/events', json(good, asProject))).status).toBe(503)
    expect(h.db.table('ops_events')).toHaveLength(0)
  })

  it('needs a key bound to one app', async () => {
    const h = harness()
    expect((await h.app.request('/v1/ops/events', json(good))).status).toBe(400)
  })
})

describe('console routes', () => {
  it('the feed is for team members only, newest first, paginated', async () => {
    const h = harness({
      ops_events: [
        { id: 'e1', organization_id: ORG, project_id: P1, category: 'alerts', severity: 'urgent', title: 'a', occurred_at: '2026-11-17T01:00:00Z', acked_at: null },
        { id: 'e2', organization_id: ORG, project_id: P1, category: 'alerts', severity: 'warn', title: 'b', occurred_at: '2026-11-17T02:00:00Z', acked_at: null },
        { id: 'e3', organization_id: OTHER_ORG, project_id: null, category: 'alerts', severity: 'warn', title: 'c', occurred_at: '2026-11-17T03:00:00Z', acked_at: null },
      ],
    })
    const res = await h.app.request(`/v1/admin/ops/events?org=${ORG}&limit=1`, { headers: { 'x-test-user': OWNER } })
    const body = await res.json()
    expect(body.data.events.map((e: { id: string }) => e.id)).toEqual(['e2'])
    expect(body.data.nextBefore).toBe('2026-11-17T02:00:00Z')
    expect(body.data.canAck).toBe(true)
    expect((await h.app.request(`/v1/admin/ops/events?org=${OTHER_ORG}`, { headers: { 'x-test-user': OWNER } })).status).toBe(403)
  })

  it('a viewer reads but cannot acknowledge; a member can', async () => {
    const h = harness({ ops_events: [{ id: '99999999-9999-4999-8999-999999999999', organization_id: ORG, project_id: P1, category: 'alerts', severity: 'urgent', title: 'down', occurred_at: '2026-11-17T01:00:00Z', acked_at: null, slack_ts: null }] })
    const id = '99999999-9999-4999-8999-999999999999'
    expect((await h.app.request(`/v1/admin/ops/events/${id}/ack`, { method: 'POST', headers: { 'x-test-user': VIEWER } })).status).toBe(403)
    const ok = await h.app.request(`/v1/admin/ops/events/${id}/ack`, { method: 'POST', headers: { 'x-test-user': OWNER } })
    expect(ok.status).toBe(200)
    expect(h.db.table('ops_events')[0]).toMatchObject({ acked_by: 'console' })
  })

  it('coverage: per app and category, today’s counts, open alerts', async () => {
    const h = harness({
      ops_events: [
        { organization_id: ORG, project_id: P1, category: 'payments', kind: 'payment.succeeded', amount_minor: 1000, currency: 'JPY', severity: 'info', occurred_at: '2026-11-17T01:00:00Z' },
        { organization_id: ORG, project_id: P1, category: 'payments', kind: 'refund.succeeded', amount_minor: 300, currency: 'JPY', severity: 'info', occurred_at: '2026-11-17T02:00:00Z' },
        { organization_id: ORG, project_id: P1, category: 'releases', kind: 'deploy.succeeded', severity: 'info', occurred_at: '2026-11-17T03:00:00Z' },
        { organization_id: ORG, project_id: P1, category: 'alerts', kind: 'x', severity: 'urgent', thread_key: 't1', acked_at: null, occurred_at: '2026-11-17T03:00:00Z' },
        { organization_id: ORG, project_id: P1, category: 'alerts', kind: 'x', severity: 'resolved', thread_key: 't1', acked_at: null, occurred_at: '2026-11-17T04:00:00Z' },
        { organization_id: ORG, project_id: P2, category: 'alerts', kind: 'x', severity: 'warn', thread_key: 't2', acked_at: null, occurred_at: '2026-11-17T04:00:00Z' },
      ],
    })
    const res = await h.app.request(`/v1/admin/ops/coverage?org=${ORG}`, { headers: { 'x-test-user': OWNER } })
    const d = (await res.json()).data
    expect(d.apps.map((a: { id: string }) => a.id).sort()).toEqual([P1, P2].sort())
    expect(d.coverage).toEqual([{ project_id: P1, category: 'payments', last_at: '2026-11-17T04:00:00Z', count_7d: 3 }])
    expect(d.today).toMatchObject({ payments: { JPY: 700 }, releases: 1, openAlerts: 1 })
    expect(d.slack.enabled).toBe(true)
  })

  it('settings never return a secret, give the Request URLs, and only owners and admins save', async () => {
    const h = harness()
    const get = await (await h.app.request(`/v1/admin/ops/slack-settings?org=${ORG}`, { headers: { 'x-test-user': VIEWER } })).json()
    expect(get.data).toMatchObject({ botToken: true, signingSecret: true, canEdit: false, command: '/kensaurus' })
    expect(JSON.stringify(get)).not.toContain('xoxb')
    expect(JSON.stringify(get)).not.toContain(SIGNING)
    expect(get.data.requestUrls.commands).toBe('https://proj.supabase.co/functions/v1/api/v1/ops/slack/commands')

    const denied = await h.app.request(`/v1/admin/ops/slack-settings?org=${ORG}`, { method: 'PUT', headers: { 'x-test-user': VIEWER, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })
    expect(denied.status).toBe(403)

    const saved = await h.app.request(`/v1/admin/ops/slack-settings?org=${ORG}`, {
      method: 'PUT',
      headers: { 'x-test-user': OWNER, 'content-type': 'application/json' },
      body: JSON.stringify({ botToken: 'xoxb-1234567890-abcdef', channels: { alerts: 'C0NEWALR' }, command: '/kensaurus' }), // check-no-secrets: ignore-line — fixture
    })
    expect(saved.status).toBe(200)
    const row = h.db.table('ops_slack_settings').find((r) => r.organization_id === ORG)!
    expect(row).toMatchObject({ bot_token_secret_id: 'vault-bot_token', team_id: 'T0TEAM', channel_alerts: 'C0NEWALR' })
    expect(JSON.stringify(row)).not.toContain('xoxb-1234567890') // check-no-secrets: ignore-line — fixture
    expect(h.slack.some((c) => c.url.endsWith('auth.test'))).toBe(true)
  })

  it('refuses a malformed token, channel or webhook', async () => {
    const h = harness()
    for (const body of [{ botToken: 'not-a-token' }, { channels: { alerts: '#alerts' } }, { webhooks: { alerts: 'https://evil.test/hooks.slack.com' } }, { command: 'kensaurus' }]) {
      const res = await h.app.request(`/v1/admin/ops/slack-settings?org=${ORG}`, { method: 'PUT', headers: { 'x-test-user': OWNER, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('test posts one message per channel and reports each result', async () => {
    const h = harness()
    const res = await (await h.app.request(`/v1/admin/ops/slack-settings/test?org=${ORG}`, { method: 'POST', headers: { 'x-test-user': OWNER } })).json()
    expect(res.data.results.map((r: { category: string; ok: boolean }) => [r.category, r.ok])).toEqual([
      ['payments', true],
      ['releases', true],
      ['alerts', true],
    ])
  })

  it('mints an ops key with exactly ops:write, labelled ops:<slug>; viewers cannot', async () => {
    const h = harness()
    expect((await h.app.request(`/v1/admin/projects/${P1}/ops-key`, { method: 'POST', headers: { 'x-test-user': VIEWER } })).status).toBe(403)
    const res = await h.app.request(`/v1/admin/projects/${P1}/ops-key`, { method: 'POST', headers: { 'x-test-user': OWNER } })
    expect(res.status).toBe(201)
    expect((await res.json()).data).toMatchObject({ key: 'mushi_plaintext', scopes: ['ops:write'], label: 'ops:glot-it' })
    expect(h.minted[0]).toMatchObject({ projectId: P1, scopes: ['ops:write'], label: 'ops:glot-it' })
  })
})

describe('Slack endpoints', () => {
  const ts = String(Math.floor(NOW.getTime() / 1000))
  async function signed(body: string, opts: { secret?: string; timestamp?: string } = {}) {
    const t = opts.timestamp ?? ts
    return { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': t, 'x-slack-signature': await computeSlackSignature(opts.secret ?? SIGNING, t, body) }
  }
  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

  it('verifies with the org’s own secret: help answers inline with the team’s command', async () => {
    const h = harness()
    const body = form({ team_id: 'T0TEAM', command: '/kensaurus', text: 'help', user_id: 'U1', response_url: 'https://hooks.slack.com/commands/x', trigger_id: 't1' })
    const res = await h.app.request('/v1/ops/slack/commands', { method: 'POST', headers: await signed(body), body })
    expect(res.status).toBe(200)
    const reply = await res.json()
    expect(reply.response_type).toBe('ephemeral')
    expect(reply.text).toContain('/kensaurus status')
  })

  it('a forged or stale signature is 401', async () => {
    const h = harness()
    const body = form({ team_id: 'T0TEAM', command: '/kensaurus', text: 'status' })
    expect((await h.app.request('/v1/ops/slack/commands', { method: 'POST', headers: await signed(body, { secret: 'f'.repeat(32) }), body })).status).toBe(401)
    expect((await h.app.request('/v1/ops/slack/commands', { method: 'POST', headers: await signed(body, { timestamp: String(Number(ts) - 600) }), body })).status).toBe(401)
  })

  it('an unknown workspace gets a plain answer and no data', async () => {
    const h = harness()
    const body = form({ team_id: 'T0NOPE', command: '/kensaurus', text: 'status' })
    const res = await h.app.request('/v1/ops/slack/commands', { method: 'POST', headers: await signed(body), body })
    expect(res.status).toBe(200)
    expect((await res.json()).text).toContain('not connected')
  })

  it('a data command acks at once and answers through response_url (Slack’s host only)', async () => {
    const h = harness({ ops_events: [{ organization_id: ORG, project_id: P1, category: 'payments', kind: 'payment.succeeded', amount_minor: 5000, currency: 'JPY', severity: 'info', occurred_at: '2026-11-17T01:00:00Z' }] })
    const body = form({ team_id: 'T0TEAM', command: '/kensaurus', text: 'sales today', user_id: 'U1', response_url: 'https://hooks.slack.com/commands/x', trigger_id: 't2' })
    const res = await h.app.request('/v1/ops/slack/commands', { method: 'POST', headers: await signed(body), body })
    expect((await res.json()).text).toContain('Looking that up')
    await Promise.all(h.background)
    const answer = h.slack.find((c) => c.url === 'https://hooks.slack.com/commands/x')
    expect(answer?.body.text).toContain('¥5,000')
    expect(answer?.body.response_type).toBe('ephemeral')

    const evil = form({ team_id: 'T0TEAM', command: '/kensaurus', text: 'status', response_url: 'https://evil.test/x', trigger_id: 't3' })
    await h.app.request('/v1/ops/slack/commands', { method: 'POST', headers: await signed(evil), body: evil })
    await Promise.all(h.background)
    expect(h.slack.some((c) => c.url.startsWith('https://evil.test'))).toBe(false)
  })

  it('Acknowledge from Slack acks the event; a button for another org’s event does nothing', async () => {
    const mine = '77777777-7777-4777-8777-777777777777'
    const theirs = '88888888-8888-4888-8888-888888888888'
    const h = harness({
      ops_events: [
        { id: mine, organization_id: ORG, project_id: P1, category: 'alerts', severity: 'urgent', title: 'down', occurred_at: '2026-11-17T01:00:00Z', acked_at: null, slack_ts: '1.1', slack_channel: 'C0ALR' },
        { id: theirs, organization_id: OTHER_ORG, project_id: null, category: 'alerts', severity: 'urgent', title: 'x', occurred_at: '2026-11-17T01:00:00Z', acked_at: null },
      ],
    })
    const press = (id: string) => form({ payload: JSON.stringify({ type: 'block_actions', trigger_id: `t-${id}`, team: { id: 'T0TEAM' }, user: { id: 'U42' }, actions: [{ action_id: 'ops_ack', value: id }] }) })
    for (const id of [mine, theirs]) {
      const body = press(id)
      expect((await h.app.request('/v1/ops/slack/interactions', { method: 'POST', headers: await signed(body), body })).status).toBe(200)
    }
    await Promise.all(h.background)
    const rows = h.db.table('ops_events')
    expect(rows.find((r) => r.id === mine)).toMatchObject({ acked_by: 'slack:U42' })
    expect(rows.find((r) => r.id === theirs)?.acked_at).toBeNull()
    expect(h.slack.some((c) => c.body.text === 'Seen by <@U42>')).toBe(true)
  })

  it('Mute 24h mutes the event’s app and says so in the thread', async () => {
    const id = '66666666-6666-4666-8666-666666666666'
    const h = harness({ ops_events: [{ id, organization_id: ORG, project_id: P2, category: 'alerts', severity: 'warn', title: 'x', occurred_at: '2026-11-17T01:00:00Z', acked_at: null, slack_ts: '2.2', slack_channel: 'C0ALR' }] })
    const body = form({ payload: JSON.stringify({ type: 'block_actions', trigger_id: 'tm', team: { id: 'T0TEAM' }, user: { id: 'U42' }, actions: [{ action_id: 'ops_mute', value: id }] }) })
    await h.app.request('/v1/ops/slack/interactions', { method: 'POST', headers: await signed(body), body })
    await Promise.all(h.background)
    expect(h.db.table('ops_mutes')[0]).toMatchObject({ organization_id: ORG, project_id: P2, until: '2026-11-18T05:00:00.000Z', muted_by: 'slack:U42' })
    expect(h.slack.some((c) => String(c.body.text).startsWith('🔕 Muted here for 24 hours'))).toBe(true)
  })

  it('reads the team before verifying, from the form or from payload.team.id', () => {
    expect(ops.slackTeamIdOf('team_id=T1&text=x')).toBe('T1')
    expect(ops.slackTeamIdOf(form({ payload: JSON.stringify({ team: { id: 'T2' } }) }))).toBe('T2')
    expect(ops.slackTeamIdOf('payload=%7Bbad')).toBeNull()
  })
})
