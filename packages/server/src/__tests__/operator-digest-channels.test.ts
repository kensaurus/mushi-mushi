/**
 * Gap #23, the operator digest beyond Slack/email/push:
 *   - Discord, Teams and Telegram each post through a project's existing
 *     connection, and one failing never stops the others;
 *   - on the team's weekday each app gets a line with its weekly signups and
 *     activations from the team funnel; a failed funnel read says so;
 *   - the settings route stores the new channels and refuses a project
 *     outside the team.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let digest: typeof import('../../supabase/functions/_shared/operator-digest.ts')
let routes: typeof import('../../supabase/functions/api/routes/digest.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  digest = await import('../../supabase/functions/_shared/operator-digest.ts')
  routes = await import('../../supabase/functions/api/routes/digest.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
// A Monday.
const MONDAY = new Date('2026-10-05T09:30:00Z')

const content = { title: 'Mushi daily digest for A', lines: ['a'], text: 'Mushi daily digest for A\n• a\nOpen the portfolio: u', hasContent: true }

function deps(over: Record<string, unknown> = {}) {
  return {
    sendSlack: vi.fn(async () => ({ ok: true })),
    sendDiscord: vi.fn(async () => ({ ok: true })),
    sendTeams: vi.fn(async () => ({ ok: false, error: 'HTTP 410' })),
    sendTelegram: vi.fn(async () => ({ sent: 2 })),
    sendEmail: vi.fn(async () => ({ ok: true })),
    sendPush: vi.fn(async () => ({ sent: 0 })),
    adminRecipients: vi.fn(async () => []),
    ...over,
  }
}

describe('deliverDigest to Discord, Teams and Telegram', () => {
  it('posts to each configured project connection with the title apart from the body', async () => {
    const d = deps()
    const r = await digest.deliverDigest({} as never, {
      organization_id: ORG, enabled: true, slack_project_id: null, discord_project_id: P1, teams_project_id: P2, telegram_project_id: P1, email: false, web_push: false,
    }, content, d)
    expect(r.channels.map((c) => [c.channel, c.ok, c.detail])).toEqual([
      ['discord', true, 'posted'],
      ['teams', false, 'HTTP 410'],
      ['telegram', true, '2 chats'],
    ])
    expect(r.status).toBe('partial')
    expect(d.sendDiscord).toHaveBeenCalledWith({}, P1, content.title, '• a\nOpen the portfolio: u')
    expect(d.sendTeams).toHaveBeenCalledWith({}, P2, content.title, '• a\nOpen the portfolio: u')
    expect(d.sendTelegram).toHaveBeenCalledWith({}, P1, content.text)
  })

  it('a Telegram project with no bound chat is a failed channel, and a thrown sender does not stop the rest', async () => {
    const d = deps({
      sendTelegram: vi.fn(async () => ({ sent: 0, error: 'no Telegram chat is bound to that project' })),
      sendDiscord: vi.fn(async () => { throw new Error('boom') }),
    })
    const r = await digest.deliverDigest({} as never, {
      organization_id: ORG, enabled: true, slack_project_id: P1, discord_project_id: P1, telegram_project_id: P1, email: false, web_push: false,
    }, content, d)
    expect(r.channels.map((c) => [c.channel, c.ok])).toEqual([['slack', true], ['discord', false], ['telegram', false]])
    expect(r.channels[2].detail).toMatch(/no Telegram chat/)
    expect(r.status).toBe('partial')
  })
})

describe('live delivery through existing project connections', () => {
  it('Discord dereferences the Vault-held webhook and posts an embed; Teams with no webhook says so', async () => {
    const { liveDeliveryDeps } = await import('../../supabase/functions/_shared/operator-digest-delivery.ts')
    const db = makeFakeDb({
      project_settings: [{ project_id: P1, discord_webhook_url: 'vault://mushi/integration/p1/discord/discord_webhook_url', teams_webhook_url: null }],
    } as never, { rpc: (fn) => (fn === 'vault_get_secret' ? 'https://discord.com/api/webhooks/1/abc' : null) })
    const calls: Array<{ url: string; body: string }> = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response(null, { status: 204 })
    }) as typeof fetch
    try {
      const r = await liveDeliveryDeps.sendDiscord(db as never, P1, 'Mushi daily digest', '• glot.it: 1 new report')
      expect(r).toEqual({ ok: true })
      expect(calls[0].url).toBe('https://discord.com/api/webhooks/1/abc')
      expect(JSON.parse(calls[0].body)).toMatchObject({ embeds: [{ title: 'Mushi daily digest', description: '• glot.it: 1 new report' }] })
      const teams = await liveDeliveryDeps.sendTeams(db as never, P1, 't', 'b')
      expect(teams).toEqual({ ok: false, error: 'that project has no Teams webhook' })
      const tg = await liveDeliveryDeps.sendTelegram(db as never, P1, 'hello')
      expect(tg).toEqual({ sent: 0, error: 'no Telegram chat is bound to that project' })
      expect(calls).toHaveLength(1)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('weekly funnel line', () => {
  it('runs on the configured UTC weekday only, and never when null', () => {
    expect(digest.isGtmDay(1, MONDAY)).toBe(true)
    expect(digest.isGtmDay(2, MONDAY)).toBe(false)
    expect(digest.isGtmDay(null, MONDAY)).toBe(false)
  })

  it('words signups, activations and a failed read', () => {
    expect(digest.gtmLine({ name: 'glot.it', gtm: { state: 'ok', firstStep: 'signed_up', lastStep: 'activated', signups: 40, activated: 9, pct: 22.5 } }))
      .toBe('This week, glot.it: 40 did signed_up, 9 reached activated (22.5%).')
    expect(digest.gtmLine({ name: 'yen', gtm: { state: 'ok', firstStep: 'signed_up', lastStep: 'activated', signups: 0, activated: 0, pct: null } }))
      .toBe('This week, yen: nobody did signed_up.')
    expect(digest.gtmLine({ name: 'yen', gtm: { state: 'error' } })).toBe('This week, yen: the funnel could not be read.')
    expect(digest.gtmLine({ name: 'yen', gtm: null })).toBeNull()
  })

  function seedFunnel(rpc: (fn: string, args: Record<string, unknown>) => unknown, extra: Record<string, unknown[]> = {}): FakeDb {
    return makeFakeDb({
      organizations: [{ id: ORG, name: 'A' }],
      projects: [{ id: P1, name: 'glot.it', organization_id: ORG }, { id: P2, name: 'yen', organization_id: ORG }],
      reports: [], releases: [], llm_invocations: [], gate_runs: [], gate_findings: [],
      org_funnel_definitions: [{ organization_id: ORG, steps: ['signed_up', 'first_report', 'activated'], conversion_window: '7d' }],
      project_settings: [{ project_id: P2, product_events_enabled: false }],
      ...extra,
    } as never, { rpc })
  }

  it('adds one line per app with events on, over the 7 days before now, and makes the digest worth sending', async () => {
    const db = seedFunnel(() => ({ steps: [{ name: 'signed_up', converted: 40 }, { name: 'first_report', converted: 20 }, { name: 'activated', converted: 9 }] }))
    const data = await digest.collectDigest(db as never, ORG, MONDAY, { gtm: true })
    expect(data.projects.find((p) => p.projectId === P1)?.gtm).toEqual({ state: 'ok', firstStep: 'signed_up', lastStep: 'activated', signups: 40, activated: 9, pct: 22.5 })
    // Product events are off for P2: no line.
    expect(data.projects.find((p) => p.projectId === P2)?.gtm).toBeNull()
    expect(db.rpcCalls).toHaveLength(1)
    expect(db.rpcCalls[0]).toMatchObject({ fn: 'product_funnel', args: { p_project_id: P1, p_from: '2026-09-28T09:30:00.000Z', p_window: '7 days' } })
    const composed = digest.composeDigest(data, 'u')
    expect(composed.hasContent).toBe(true)
    expect(composed.lines).toContain('This week, glot.it: 40 did signed_up, 9 reached activated (22.5%).')
  })

  it('reads nothing on other days and adds nothing without a team funnel', async () => {
    const db = seedFunnel(() => ({ steps: [] }))
    const off = await digest.collectDigest(db as never, ORG, MONDAY)
    expect(off.projects.every((p) => p.gtm === null)).toBe(true)
    expect(db.rpcCalls).toHaveLength(0)
    const none = seedFunnel(() => ({ steps: [] }), { org_funnel_definitions: [] })
    const data = await digest.collectDigest(none as never, ORG, MONDAY, { gtm: true })
    expect(data.projects.every((p) => p.gtm === null)).toBe(true)
  })

  it('says the funnel could not be read instead of reporting zero signups', async () => {
    const db = seedFunnel(() => null)
    const broken = new Proxy(db, { get: (t, prop, r) => (prop === 'rpc' ? async () => ({ data: null, error: { message: 'timeout' } }) : Reflect.get(t, prop, r)) })
    const data = await digest.collectDigest(broken as never, ORG, MONDAY, { gtm: true })
    expect(data.projects.find((p) => p.projectId === P1)?.gtm).toEqual({ state: 'error' })
  })
})

// ── settings route ───────────────────────────────────────────────────────────

type Ctx = {
  req: { json: () => Promise<unknown>; param: (k: string) => string | undefined; query: () => undefined; header: () => undefined }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: unknown, status?: number) => { body: unknown; status: number }
}
type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Res { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  put(p: string, ...h: Handler[]) { this.add('PUT', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<Res> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c: Ctx = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => vars[k], set: (k: string, v: unknown) => { vars[k] = v },
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      let result: unknown
      const go = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        const short = await r.handlers[i](c, () => go(i + 1))
        if (result === undefined && short !== undefined) result = short
      }
      await go(0)
      return result as Res
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function harness() {
  const db = makeFakeDb({
    organizations: [{ id: ORG, name: 'A' }],
    projects: [{ id: P1, name: 'glot.it', owner_id: 'owner', organization_id: ORG }],
    organization_members: [{ organization_id: ORG, user_id: 'owner', role: 'owner' }],
    project_members: [],
    reports: [], releases: [], llm_invocations: [], gate_runs: [], gate_findings: [], org_funnel_definitions: [],
  } as never)
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const delivery = deps({ sendTeams: vi.fn(async () => ({ ok: true })) })
  routes.registerDigestRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass, jwtAuth: pass, delivery, now: () => MONDAY } as never)
  return { app, db, delivery }
}

describe('digest settings with the new channels', () => {
  it('a Teams channel alone is enough to switch the digest on, and the weekly day is stored', async () => {
    const { app, db } = harness()
    const res = await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, teamsProjectId: P1, gtmWeekday: 3 } })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ enabled: true, teamsProjectId: P1, discordProjectId: null, telegramProjectId: null, gtmWeekday: 3 })
    expect(db.table('operator_digest_settings')[0]).toMatchObject({ teams_project_id: P1, gtm_weekday: 3 })
    // Leaving a field out keeps it; null switches the weekly line off.
    const off = await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, gtmWeekday: null } })
    expect(off.body.data).toMatchObject({ teamsProjectId: P1, gtmWeekday: null })
  })

  it('refuses a Discord or Telegram project outside the team', async () => {
    const { app } = harness()
    const foreign = '9000000a-0000-4000-8000-000000000000'
    expect((await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, discordProjectId: foreign } })).status).toBe(404)
    expect((await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, telegramProjectId: foreign } })).status).toBe(404)
  })

  it('shows the default Monday before a team saves anything', async () => {
    const { app } = harness()
    const res = await app.call('GET', `/v1/admin/orgs/${ORG}/digest`)
    expect(res.body.data).toMatchObject({ settings: { gtmWeekday: 1, discordProjectId: null, teamsProjectId: null, telegramProjectId: null } })
  })

  it('sends now through Teams', async () => {
    const { app, delivery } = harness()
    await app.call('PUT', `/v1/admin/orgs/${ORG}/digest/settings`, { body: { enabled: true, teamsProjectId: P1 } })
    const res = await app.call('POST', `/v1/admin/orgs/${ORG}/digest/send`)
    // The app was never hole-checked, which the digest always says out loud.
    expect(res.body.data).toMatchObject({ status: 'sent', channels: [{ channel: 'teams', ok: true, detail: 'posted' }] })
    expect(delivery.sendTeams).toHaveBeenCalledWith(expect.anything(), P1, 'Mushi daily digest for A', expect.stringContaining('1 app has not had hole checks yet.'))
  })
})
