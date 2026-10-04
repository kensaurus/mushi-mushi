/**
 * FILE: pdca-routes-console.test.ts
 * PURPOSE: /iterate console QA group C, against the real pdca route module.
 *
 *   #100  The console offered personas ("accessibility", "conversion",
 *         "senior-dev") that agent_personas never had, and the route stored
 *         any slug, so pdca-runner silently used its generic critic. The
 *         route now refuses an unknown slug, and the console list must equal
 *         the seeded slugs.
 *   #101  A failed Trigger answered `{ ok:false, error: <runner body> }`, so
 *         the console showed only "Trigger failed". The runner's reason now
 *         reaches the caller as `error.message`.
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000d-0000-4000-8000-000000000000'
const USER = '2000000d-0000-4000-8000-000000000000'
const RUN = '3000000d-0000-4000-8000-000000000000'

let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/api/middleware/auth.ts', () => ({
  requireAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  },
}))
vi.mock('../../supabase/functions/api/middleware/project.ts', () => ({
  checkProjectAccessIfNamed: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/project-access.ts', () => ({ accessibleProjectIds: async () => [P] }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  assertCallerProjectScope: () => null,
  assertTargetProjectAccess: async () => ({ ok: true }),
  callerProjectIds: async () => [P],
  resolveOwnedProject: async () => ({ project: { id: P, name: 'p' } }),
}))

const MIGRATION = resolve(__dirname, '../../supabase/migrations/20260520000000_mistake_clusters.sql')
const ADMIN_TYPES = resolve(__dirname, '../../../../apps/admin/src/components/iterate/types.ts')

function seededPersonaSlugs(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8')
  const block = sql.slice(sql.indexOf('insert into agent_personas'), sql.indexOf('on conflict (slug)'))
  return [...block.matchAll(/^\(\s*\n\s*'([a-z0-9-]+)'/gm)].map((m) => m[1]!)
}

let app: Hono
const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }))

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => 'http://fake' } }
  const { registerPdcaRoutes } = await import('../../supabase/functions/api/routes/pdca.ts')
  app = new Hono()
  registerPdcaRoutes(app as never)
})

beforeEach(() => {
  db = makeFakeDb(
    {
      agent_personas: seededPersonaSlugs().map((slug) => ({ slug })),
      pdca_runs: [{ id: RUN, project_id: P, status: 'queued', target_url: 'https://a.test' }],
    },
    { autoId: true },
  )
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('#100 critic personas', () => {
  it('the console offers exactly the seeded personas', () => {
    const seeded = seededPersonaSlugs()
    expect(seeded).toEqual(['tufte-data-density', 'nng-heuristic', 'wcag-a11y', 'mobile-first', 'glanceable-density'])
    const admin = readFileSync(ADMIN_TYPES, 'utf8')
    const block = admin.slice(admin.indexOf('export const PERSONA_OPTIONS'), admin.indexOf('] as const'))
    const offered = [...block.matchAll(/value: '([a-z0-9-]+)'/g)].map((m) => m[1]!)
    expect([...offered].sort()).toEqual([...seeded].sort())
  })

  it('queues a run with a seeded persona', async () => {
    const res = await call('POST', '/v1/admin/pdca', {
      project_id: P,
      target_url: 'https://a.test',
      goal: 'g',
      persona: 'wcag-a11y',
    })
    expect(res.status).toBe(201)
    expect(res.json.data.persona).toBe('wcag-a11y')
  })

  it('refuses a persona the runner does not have, in plain English', async () => {
    const res = await call('POST', '/v1/admin/pdca', {
      project_id: P,
      target_url: 'https://a.test',
      goal: 'g',
      persona: 'accessibility',
    })
    expect(res.status).toBe(400)
    expect(res.json.error.message).toContain('There is no critic persona called "accessibility"')
    expect(db.tables.pdca_runs).toHaveLength(1)
  })
})

describe('#101 trigger failures keep the runner reason', () => {
  it('passes a string error through as the message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'Run not found or already taken' }), { status: 409 }),
    )
    const res = await call('POST', `/v1/admin/pdca/${RUN}/trigger`)
    expect(res.status).toBe(409)
    expect(res.json.error.message).toBe('Run not found or already taken')
  })

  it('passes a nested error object through', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: 'NO_LLM_KEY', message: 'Add an Anthropic key in Settings.' } }), { status: 400 }),
    )
    const res = await call('POST', `/v1/admin/pdca/${RUN}/trigger`)
    expect(res.json.error).toEqual({ code: 'NO_LLM_KEY', message: 'Add an Anthropic key in Settings.' })
  })
})
