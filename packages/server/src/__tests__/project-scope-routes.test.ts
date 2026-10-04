/**
 * FILE: project-scope-routes.test.ts
 * PURPOSE: Routes that act on one project must act only on a project the
 *          caller can reach, against the real route modules mounted on Hono.
 *
 *   - requireProjectAccess fails closed when no project is named;
 *     checkProjectAccessIfNamed is the explicit opt-out.
 *   - Anomalies: confirm/dismiss, detect and metric ingest.
 *   - Skill pipeline start with a report id.
 *   - PDCA "improve QA stories".
 *
 * Each cross-project case asserts the refusal AND that nothing was written.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const ORG_A = 'a0000000-0000-4000-8000-000000000001'
const ORG_B = 'b0000000-0000-4000-8000-000000000001'
const PA = 'a0000000-0000-4000-8000-0000000000aa'
const PB = 'b0000000-0000-4000-8000-0000000000bb'
const USER = 'c0000000-0000-4000-8000-000000000001'
const OTHER = 'd0000000-0000-4000-8000-000000000001'
const ANOM_A = 'a0000000-0000-4000-8000-00000000a001'
const ANOM_B = 'b0000000-0000-4000-8000-00000000b001'
const REPORT_A = 'a0000000-0000-4000-8000-00000000c001'
const REPORT_B = 'b0000000-0000-4000-8000-00000000c001'

let db: FakeDb
let auth: { userId: string; authMethod: 'jwt' | 'apiKey'; projectId?: string }

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', auth.userId)
    c.set('authMethod', auth.authMethod)
    if (auth.projectId) c.set('projectId', auth.projectId)
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', () => ({
  claimTenantRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  logTenantContext: () => {},
  tenantContextFromHono: () => ({}),
}))
vi.mock('../../supabase/functions/_shared/rag.ts', () => ({ getRelevantCode: vi.fn(async () => []) }))
vi.mock('../../supabase/functions/_shared/skill-packet.ts', () => ({
  composeRunPacket: vi.fn((args: { reportContext: { id: string; summary: string | null } }) =>
    `packet for ${args.reportContext.id}: ${args.reportContext.summary ?? ''}`,
  ),
  resolveChain: vi.fn(async (slug: string) => [slug]),
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({ dispatchPluginEvent: vi.fn(async () => {}) }))

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ anomalies: 0, ids: [] }), { status: 200 }))

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => 'http://fake.local' } }
  const { registerAnomaliesRoutes } = await import('../../supabase/functions/api/routes/anomalies.ts')
  const { registerSkillsRoutes } = await import('../../supabase/functions/api/routes/skills.ts')
  const { registerPdcaRoutes } = await import('../../supabase/functions/api/routes/pdca.ts')
  app = new Hono()
  registerAnomaliesRoutes(app as never)
  registerSkillsRoutes(app as never)
  registerPdcaRoutes(app as never)
})

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  db = makeFakeDb(
    {
      projects: [
        { id: PA, name: 'App A', owner_id: USER, organization_id: ORG_A },
        { id: PB, name: 'App B', owner_id: OTHER, organization_id: ORG_B },
      ],
      organization_members: [
        { organization_id: ORG_A, user_id: USER, role: 'owner' },
        { organization_id: ORG_B, user_id: OTHER, role: 'owner' },
      ],
      project_members: [],
      anomaly_detections: [
        { id: ANOM_A, project_id: PA, status: 'open', confirmed: false },
        { id: ANOM_B, project_id: PB, status: 'open', confirmed: false },
      ],
      metric_series: [],
      reports: [
        { id: REPORT_A, project_id: PA, summary: 'A summary', stage2_analysis: { rootCause: 'A cause' } },
        { id: REPORT_B, project_id: PB, summary: 'B secret summary', stage2_analysis: { rootCause: 'B cause' } },
      ],
      agent_skills: [{ slug: 'fix-it', title: 'Fix it', description: 'd', body_md: 'b', chain_slugs: [], is_active: true }],
      skill_pipeline_runs: [],
      skill_pipeline_step_runs: [],
      ...extra,
    },
    { autoId: true },
  )
}

beforeEach(() => {
  auth = { userId: USER, authMethod: 'jwt' }
  seed()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> }
}

const anomaly = (id: string) => db.tables.anomaly_detections.find((r) => r.id === id)!

describe('project middleware', () => {
  async function mini(variant: 'strict' | 'ifNamed') {
    const mod = await import('../../supabase/functions/api/middleware/project.ts')
    const mw = variant === 'strict' ? mod.requireProjectAccess : mod.checkProjectAccessIfNamed
    const h = new Hono()
    h.use('*', async (c, next) => {
      c.set('userId' as never, auth.userId as never)
      c.set('authMethod' as never, auth.authMethod as never)
      if (auth.projectId) c.set('projectId' as never, auth.projectId as never)
      await next()
    })
    h.use('*', mw as never)
    h.get('/x', (c) => c.json({ ok: true }))
    return h
  }

  it('requireProjectAccess refuses a request that names no project', async () => {
    const res = await (await mini('strict')).request('/x')
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error.code).toBe('PROJECT_REQUIRED')
  })

  it('requireProjectAccess refuses another tenant\'s project and admits the caller\'s own', async () => {
    const h = await mini('strict')
    expect((await h.request(`/x?project_id=${PB}`)).status).toBe(403)
    expect((await h.request('/x', { headers: { 'X-Mushi-Project-Id': PB } })).status).toBe(403)
    expect((await h.request(`/x?project_id=${PA}`)).status).toBe(200)
  })

  it('requireProjectAccess treats a bound API key as naming its own project', async () => {
    auth = { userId: USER, authMethod: 'apiKey', projectId: PA }
    const h = await mini('strict')
    expect((await h.request('/x')).status).toBe(200)
    expect((await h.request(`/x?project_id=${PB}`)).status).toBe(403)
  })

  it('checkProjectAccessIfNamed still checks a named project and passes an unnamed one', async () => {
    const h = await mini('ifNamed')
    expect((await h.request(`/x?project_id=${PB}`)).status).toBe(403)
    expect((await h.request('/x')).status).toBe(200)
  })
})

describe('anomalies: confirm / dismiss', () => {
  it('refuses another tenant\'s anomaly with 404 and leaves it unchanged', async () => {
    const { status } = await call('PATCH', `/v1/admin/anomalies/${ANOM_B}`, { status: 'dismissed' })
    expect(status).toBe(404)
    expect(anomaly(ANOM_B).status).toBe('open')
  })

  it('refuses it even when the request names the caller\'s own project', async () => {
    const { status } = await call('PATCH', `/v1/admin/anomalies/${ANOM_B}`, { status: 'dismissed' }, {
      'X-Mushi-Project-Id': PA,
    })
    expect(status).toBe(404)
    expect(anomaly(ANOM_B).status).toBe('open')
  })

  it('confirms the caller\'s own anomaly', async () => {
    const { status } = await call('PATCH', `/v1/admin/anomalies/${ANOM_A}`, { status: 'confirmed', confirmed: true })
    expect(status).toBe(200)
    expect(anomaly(ANOM_A)).toMatchObject({ status: 'confirmed', confirmed: true })
  })

  it('rejects a status outside open / confirmed / dismissed', async () => {
    const { status } = await call('PATCH', `/v1/admin/anomalies/${ANOM_A}`, { status: 'deleted' })
    expect(status).toBe(400)
    expect(anomaly(ANOM_A).status).toBe('open')
  })
})

describe('anomalies: detect', () => {
  it('refuses to run detection for another tenant\'s project', async () => {
    const { status } = await call('POST', '/v1/admin/anomalies/detect', { project_id: PB })
    expect(status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('runs detection for the caller\'s own project', async () => {
    const { status } = await call('POST', '/v1/admin/anomalies/detect', { project_id: PA, lookback_hours: 24 })
    expect(status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent).toMatchObject({ project_id: PA, lookback_hours: 24 })
  })
})

describe('metric-series ingest', () => {
  const point = (projectId: string, extra: Record<string, unknown> = {}) => ({
    project_id: projectId,
    metric_name: 'error_rate',
    value: 0.5,
    ts: '2026-10-01T00:00:00.000Z',
    ...extra,
  })

  it('refuses points for another tenant\'s project and writes nothing', async () => {
    const { status } = await call('POST', '/v1/admin/metric-series', point(PB))
    expect(status).toBe(403)
    expect(db.tables.metric_series).toHaveLength(0)
  })

  it('refuses a batch that mixes projects and writes nothing', async () => {
    const { status } = await call('POST', '/v1/admin/metric-series', [point(PA), point(PB)])
    expect(status).toBe(400)
    expect(db.tables.metric_series).toHaveLength(0)
  })

  it('stores the caller\'s own points, keeping only the known columns', async () => {
    const forgedId = 'e0000000-0000-4000-8000-000000000001'
    const { status, json } = await call('POST', '/v1/admin/metric-series', point(PA, { id: forgedId, created_at: '1999-01-01' }))
    expect(status).toBe(201)
    expect(json.inserted).toBe(1)
    const row = db.tables.metric_series[0]
    expect(row).toMatchObject({ project_id: PA, metric_name: 'error_rate', value: 0.5, dimension: null })
    expect(row.id).not.toBe(forgedId)
    expect(row.created_at).toBeUndefined()
  })
})

describe('skill pipeline start', () => {
  it('returns 404 for a report in another tenant\'s project and starts no run', async () => {
    const { status } = await call('POST', '/v1/admin/skills/pipelines', {
      project_id: PA,
      root_skill_slug: 'fix-it',
      report_id: REPORT_B,
    })
    expect(status).toBe(404)
    expect(db.tables.skill_pipeline_runs).toHaveLength(0)
  })

  it('builds the packet from the caller\'s own report', async () => {
    const { status } = await call('POST', '/v1/admin/skills/pipelines', {
      project_id: PA,
      root_skill_slug: 'fix-it',
      report_id: REPORT_A,
    })
    expect(status).toBe(201)
    expect(db.tables.skill_pipeline_runs).toHaveLength(1)
    expect(String(db.tables.skill_pipeline_runs[0].context_packet)).toContain('A summary')
  })
})

describe('pdca: improve QA stories', () => {
  it('refuses another tenant\'s project without calling the runner', async () => {
    const { status } = await call('POST', '/v1/admin/pdca/improve-qa-stories', { project_id: PB })
    expect(status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a request that names no project instead of improving every project', async () => {
    const { status } = await call('POST', '/v1/admin/pdca/improve-qa-stories', {})
    expect(status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('runs for the caller\'s own project', async () => {
    const { status } = await call('POST', '/v1/admin/pdca/improve-qa-stories', { project_id: PA })
    expect(status).toBe(200)
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent).toEqual({ mode: 'qa_story_improve', project_id: PA })
  })
})
