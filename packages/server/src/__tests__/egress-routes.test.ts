/**
 * `api/routes/egress.ts` (Plan 023 Phase 0): GET /v1/admin/egress/status and
 * POST /v1/admin/egress/selftest through the real handlers with injected
 * deps, plus the pure integrations table and the self-test probe against the
 * real guard.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  installEgressGuard,
  policyFromEnv,
  uninstallEgressGuard,
} from '../../supabase/functions/_shared/egress.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', () => ({ claimTenantRateLimit: async () => ({ allowed: true }) }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerProjectIds: async () => [],
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

let egress: typeof import('../../supabase/functions/api/routes/egress.ts')
beforeAll(async () => {
  egress = await import('../../supabase/functions/api/routes/egress.ts')
})

const P1 = '1000000a-0000-4000-8000-000000000000'
const SUPABASE_URL = 'http://kong:8000'
const LOCAL = policyFromEnv({ MUSHI_LOCAL_ONLY: '1', MUSHI_EGRESS_ALLOW: 'ollama', SUPABASE_URL })
const CLOUD = policyFromEnv({ SUPABASE_URL: 'https://abcd.supabase.co' })

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

function harness(over: Partial<import('../../supabase/functions/api/routes/egress.ts').EgressRouteDeps> = {}) {
  const routes: Array<{ method: string; path: string; handler: Handler }> = []
  const app = {
    get: (path: string, ...h: Handler[]) => routes.push({ method: 'GET', path, handler: h[h.length - 1]! }),
    post: (path: string, ...h: Handler[]) => routes.push({ method: 'POST', path, handler: h[h.length - 1]! }),
  }
  const rate = { allowed: true, keys: [] as string[] }
  const deps = {
    ...egress.defaultEgressRouteDeps,
    getServiceClient: () => ({}) as never,
    claimRateLimit: vi.fn(async (_db: unknown, key: string) => {
      rate.keys.push(key)
      return { allowed: rate.allowed, retryAfterSec: 120 }
    }) as never,
    callerProjectIds: vi.fn(async () => [P1]) as never,
    callerCanAccessProject: vi.fn(async () => ({ allowed: true, role: 'member' })) as never,
    env: () => ({ ANTHROPIC_API_KEY: 'x', ANTHROPIC_BASE_URL: 'http://ollama:11434' }),
    policy: () => LOCAL,
    loadDenials: vi.fn(async () => [{ host: 'api.openai.com', caller: 'judge-batch', day: '2026-10-21', count: 3, lastAt: '2026-10-21T08:00:00Z' }]),
    loadSettings: vi.fn(async () => ({ ...egress.EMPTY_EGRESS_SETTINGS })),
    probe: vi.fn(async (host: string) => ({ host, outcome: 'blocked_by_mushi' as const, ms: 1 })),
    now: () => new Date('2026-10-21T09:00:00Z'),
    ...over,
  }
  egress.registerEgressRoutes(app as never, deps as never)
  async function call(method: string, path: string, opts: { body?: unknown; query?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'jwt', ...opts.vars }
    const c = {
      req: { json: async () => opts.body ?? {}, query: (k: string) => opts.query?.[k], param: () => undefined, header: () => undefined },
      get: (k: string) => vars[k],
      header: () => {},
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
  return { call, deps, rate }
}

describe('GET /v1/admin/egress/status', () => {
  it('returns localOnly, the allowlist, denials and the integrations table', async () => {
    const { call } = harness()
    const res = await call('GET', '/v1/admin/egress/status')
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.localOnly).toBe(true)
    expect(d.allowlist[0]).toBe('kong')
    expect(d.allowlist).toContain('ollama')
    expect(d.denials).toEqual([{ host: 'api.openai.com', caller: 'judge-batch', day: '2026-10-21', count: 3, lastAt: '2026-10-21T08:00:00Z' }])
    const anthropic = d.integrations.find((i: { id: string }) => i.id === 'anthropic')
    expect(anthropic).toMatchObject({ destination: 'ollama:11434', enabled: true, allowed: true })
    const github = d.integrations.find((i: { id: string }) => i.id === 'github')
    expect(github).toMatchObject({ destination: 'api.github.com', allowed: false })
    for (const row of d.integrations) expect(Object.keys(row).sort()).toEqual(['allowed', 'destination', 'enabled', 'id', 'label', 'note'])
  })

  it('shows an empty allowlist and everything allowed when local-only is off', async () => {
    const { call } = harness({ policy: () => CLOUD })
    const d = (await call('GET', '/v1/admin/egress/status')).body.data
    expect(d.localOnly).toBe(false)
    expect(d.allowlist).toEqual([])
    expect(d.integrations.every((i: { allowed: boolean }) => i.allowed)).toBe(true)
  })

  it('answers 500 when the denial log cannot be read', async () => {
    const { call } = harness({ loadDenials: async () => { throw new Error('down') } })
    const res = await call('GET', '/v1/admin/egress/status')
    expect(res.status).toBe(500)
    expect(res.body.error?.code).toBe('DB_ERROR')
  })
})

describe('POST /v1/admin/egress/selftest', () => {
  it('tries every listed host and passes when local-only is on and none is reachable', async () => {
    const { call, deps, rate } = harness()
    const res = await call('POST', '/v1/admin/egress/selftest', { body: { project_id: P1 } })
    expect(res.status).toBe(200)
    expect(res.body.data.localOnly).toBe(true)
    expect(res.body.data.passed).toBe(true)
    expect(res.body.data.results.map((r: { host: string }) => r.host)).toEqual([...egress.EGRESS_SELFTEST_HOSTS])
    expect(deps.probe).toHaveBeenCalledTimes(8)
    expect(rate.keys).toEqual([`project:${P1}:egress_selftest`])
  })

  it('fails when any host is reachable, or when local-only is off', async () => {
    const reachable = harness({ probe: async (host: string) => ({ host, outcome: host === 'sentry.io' ? 'reachable' : 'network_unreachable', ms: 2 }) })
    expect((await reachable.call('POST', '/v1/admin/egress/selftest', { body: { project_id: P1 } })).body.data.passed).toBe(false)
    const off = harness({ policy: () => CLOUD, probe: async (host: string) => ({ host, outcome: 'network_unreachable', ms: 2 }) })
    expect((await off.call('POST', '/v1/admin/egress/selftest', { body: { project_id: P1 } })).body.data.passed).toBe(false)
  })

  it('uses the caller\'s first project when none is named', async () => {
    const { call, rate } = harness()
    expect((await call('POST', '/v1/admin/egress/selftest')).status).toBe(200)
    expect(rate.keys).toEqual([`project:${P1}:egress_selftest`])
  })

  it('refuses viewers, unknown projects and the seventh run in an hour', async () => {
    const viewer = harness({ callerCanAccessProject: (async () => ({ allowed: true, role: 'viewer' })) as never })
    expect((await viewer.call('POST', '/v1/admin/egress/selftest', { body: { project_id: P1 } })).status).toBe(403)
    const stranger = harness({ callerCanAccessProject: (async () => ({ allowed: false, role: null })) as never })
    expect((await stranger.call('POST', '/v1/admin/egress/selftest', { body: { project_id: P1 } })).status).toBe(404)
    const limited = harness()
    limited.rate.allowed = false
    const res = await limited.call('POST', '/v1/admin/egress/selftest', { body: { project_id: P1 } })
    expect(res.status).toBe(429)
    expect(limited.deps.probe).not.toHaveBeenCalled()
  })

  it('asks for a project when the caller has none', async () => {
    const { call } = harness({ callerProjectIds: (async () => []) as never })
    const res = await call('POST', '/v1/admin/egress/selftest')
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('PROJECT_REQUIRED')
  })
})

describe('probeEgressHost against the real guard', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    uninstallEgressGuard()
    globalThis.fetch = realFetch
  })

  it('reports blocked_by_mushi without touching the network', async () => {
    const original = vi.fn(async () => new Response('should not happen'))
    globalThis.fetch = original as unknown as typeof fetch
    installEgressGuard({ env: { MUSHI_LOCAL_ONLY: '1', SUPABASE_URL }, record: () => {} })
    const r = await egress.probeEgressHost('api.anthropic.com')
    expect(r.outcome).toBe('blocked_by_mushi')
    expect(original).not.toHaveBeenCalled()
  })

  it('reports network_unreachable on a connection failure and reachable on any answer', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    expect((await egress.probeEgressHost('api.openai.com')).outcome).toBe('network_unreachable')
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    expect((await egress.probeEgressHost('api.openai.com')).outcome).toBe('reachable')
  })
})

describe('buildEgressIntegrations', () => {
  it('adds a row for each distinct BYOK base URL and marks SMTP as the mail destination', () => {
    const rows = egress.buildEgressIntegrations(
      { SMTP_URL: 'smtp://user:pw@mail.internal:587' },
      { ...egress.EMPTY_EGRESS_SETTINGS, byok: [{ provider: 'anthropic', baseUrl: 'http://10.0.0.9:11434' }, { provider: 'anthropic', baseUrl: null }] },
      LOCAL,
    )
    expect(rows.find((r) => r.id === 'anthropic')).toMatchObject({ destination: 'api.anthropic.com', enabled: true, allowed: false })
    expect(rows.find((r) => r.id === 'anthropic@10.0.0.9:11434')).toMatchObject({ enabled: true, allowed: true })
    const email = rows.find((r) => r.id === 'email')!
    expect(email).toMatchObject({ label: 'Email (SMTP)', destination: 'mail.internal:587', allowed: true })
    // No credentials ever reach the table.
    expect(JSON.stringify(rows)).not.toContain('pw')
  })
})
