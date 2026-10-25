/**
 * Route-level gate for QA coverage (`jwtOrApiKey` in `api/routes/qa-coverage.ts`).
 *
 * The payload test mocks `adminOrApiKey` as a pass-through and only calls
 * `qaApiKeyScope`. This file mounts the real routes on Hono and uses the real
 * `adminOrApiKey`, so an account key is checked the way a request is:
 * scope, the owner's membership (`resolveProject` / `ownedProjectIds`), and a
 * selected-projects limit (`allowed_project_ids`). Project keys still blank
 * `userId`; account keys keep the owner so a viewer cannot start a run.
 *
 * CLI callers send `X-Mushi-Api-Key` (and a Bearer copy of the same key).
 * The console sends a Supabase JWT. This file covers those headers along
 * with `Authorization: Bearer mushi_…`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'
import { hashApiKey } from '../../supabase/functions/_shared/api-key-mint.ts'

const state = vi.hoisted(() => ({ db: null as FakeDb | null }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportError: vi.fn(),
  reportMessage: vi.fn(),
  ensureSentry: () => {},
}))

const ORG = '5000000a-0000-4000-8000-000000000001'
const P_MINE = '1000000a-0000-4000-8000-000000000001'
const P_TEAM = '1000000a-0000-4000-8000-000000000002'
const P_FOREIGN = '1000000a-0000-4000-8000-000000000003'
const OWNER = '2000000a-0000-4000-8000-000000000001'
const STRANGER = '2000000a-0000-4000-8000-000000000002'
const VIEWER = '2000000a-0000-4000-8000-000000000003'
const SID_MINE = '3000000a-0000-4000-8000-000000000001'
const SID_TEAM = '3000000a-0000-4000-8000-000000000002'
const SID_FOREIGN = '3000000a-0000-4000-8000-000000000003'
const RUN_MINE = '4000000a-0000-4000-8000-000000000001'
const RUN_TEAM = '4000000a-0000-4000-8000-000000000002'
const RUN_FOREIGN = '4000000a-0000-4000-8000-000000000003'

const JWT_OWNER = 'jwt-owner'
const JWT_VIEWER = 'jwt-viewer'

const ACCOUNT_READ = 'mushi_acctread00000000000000000001'
const ACCOUNT_WRITE = 'mushi_acctwrite0000000000000000001'
const ACCOUNT_LIMITED = 'mushi_acctlimit0000000000000000001'
const PROJECT_KEY = 'mushi_projectkey000000000000000001'
const VIEWER_WRITE = 'mushi_viewerwrite00000000000000001'

let app: Hono
const prevDeno = (globalThis as { Deno?: unknown }).Deno

function story(id: string, projectId: string): Row {
  return {
    id,
    project_id: projectId,
    name: id,
    browser_provider: 'firecrawl_actions',
    script: null,
    prompt: 'check the page',
    enabled: true,
  }
}

function run(id: string, storyId: string, projectId: string): Row {
  return {
    id,
    story_id: storyId,
    project_id: projectId,
    status: 'passed',
    latency_ms: 10,
    started_at: '2026-10-01T00:00:00Z',
    finished_at: '2026-10-01T00:00:01Z',
    provider: 'firecrawl_actions',
    provider_session_url: null,
    summary: 'ok',
    assertion_failures: null,
    error_message: null,
    triggered_by: 'schedule',
    created_at: '2026-10-01T00:00:00Z',
  }
}

async function keyRow(raw: string, fields: Row): Promise<Row> {
  return {
    id: `key-${raw.slice(6, 14)}`,
    key_hash: await hashApiKey(raw),
    key_prefix: raw.slice(0, 12),
    is_active: true,
    projects: { name: 'App' },
    last_seen_origin: null,
    browser_seen_at: null,
    ...fields,
  }
}

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  state.db = makeFakeDb(
    {
      projects: [
        { id: P_MINE, name: 'Mine', owner_id: OWNER, organization_id: ORG },
        { id: P_TEAM, name: 'Team', owner_id: 'someone-else', organization_id: ORG },
        { id: P_FOREIGN, name: 'Foreign', owner_id: 'someone-else', organization_id: null },
      ],
      organization_members: [
        { organization_id: ORG, user_id: OWNER, role: 'admin' },
        { organization_id: ORG, user_id: VIEWER, role: 'viewer' },
      ],
      project_members: [],
      project_api_keys: await Promise.all([
        keyRow(ACCOUNT_READ, {
          project_id: null,
          is_org_scoped: true,
          allowed_project_ids: null,
          scopes: ['mcp:read'],
          owner_user_id: OWNER,
        }),
        keyRow(ACCOUNT_WRITE, {
          project_id: null,
          is_org_scoped: true,
          allowed_project_ids: null,
          scopes: ['mcp:write'],
          owner_user_id: OWNER,
        }),
        keyRow(ACCOUNT_LIMITED, {
          project_id: null,
          is_org_scoped: true,
          allowed_project_ids: [P_MINE],
          scopes: ['mcp:write'],
          owner_user_id: OWNER,
        }),
        keyRow(PROJECT_KEY, {
          project_id: P_MINE,
          is_org_scoped: false,
          allowed_project_ids: null,
          scopes: ['mcp:write'],
          owner_user_id: STRANGER,
        }),
        keyRow(VIEWER_WRITE, {
          project_id: null,
          is_org_scoped: true,
          allowed_project_ids: null,
          scopes: ['mcp:write'],
          owner_user_id: VIEWER,
        }),
      ]),
      qa_stories: [story(SID_MINE, P_MINE), story(SID_TEAM, P_TEAM), story(SID_FOREIGN, P_FOREIGN)],
      qa_story_runs: [
        run(RUN_MINE, SID_MINE, P_MINE),
        run(RUN_TEAM, SID_TEAM, P_TEAM),
        run(RUN_FOREIGN, SID_FOREIGN, P_FOREIGN),
      ],
    },
    { autoId: true },
  )
  Object.assign(state.db!, {
    auth: {
      getClaims: async (jwt: string) => {
        const sub = jwt === JWT_OWNER ? OWNER : jwt === JWT_VIEWER ? VIEWER : ''
        if (!sub) return { data: null, error: { message: 'invalid' } }
        return {
          data: { claims: { sub, role: 'authenticated', email: `${sub}@example.test` } },
          error: null,
        }
      },
    },
  })
  const { registerQaCoverageRoutes } = await import('../../supabase/functions/api/routes/qa-coverage.ts')
  app = new Hono()
  registerQaCoverageRoutes(app as never)
})

afterAll(() => {
  ;(globalThis as { Deno?: unknown }).Deno = prevDeno
})

function runsPath(projectId: string, storyId: string): string {
  return `/v1/admin/projects/${projectId}/qa-stories/${storyId}/runs`
}

function runPath(projectId: string, storyId: string): string {
  return `/v1/admin/projects/${projectId}/qa-stories/${storyId}/run`
}

async function call(method: string, path: string, rawKeyOrHeaders: string | Record<string, string>) {
  const headers =
    typeof rawKeyOrHeaders === 'string' ? { Authorization: `Bearer ${rawKeyOrHeaders}` } : rawKeyOrHeaders
  const res = await app.request(path, {
    method,
    headers,
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* non-JSON body (a 500 from an unfinalized context) stays text */
  }
  return { status: res.status, body }
}

function expectRuns(body: unknown, id: string) {
  expect(body).toEqual({
    ok: true,
    data: { runs: expect.arrayContaining([expect.objectContaining({ id })]) },
  })
}

describe('account key reading QA runs', () => {
  it('returns runs for a project the owner can reach', async () => {
    const res = await call('GET', runsPath(P_TEAM, SID_TEAM), ACCOUNT_READ)
    expect(res.status).toBe(200)
    expectRuns(res.body, RUN_TEAM)
  })

  it('returns 404 for a project the owner does not belong to', async () => {
    const res = await call('GET', runsPath(P_FOREIGN, SID_FOREIGN), ACCOUNT_READ)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })

  it('returns 404 for a project outside the key selected-projects limit', async () => {
    const allowed = await call('GET', runsPath(P_MINE, SID_MINE), ACCOUNT_LIMITED)
    expect(allowed.status).toBe(200)
    expectRuns(allowed.body, RUN_MINE)

    const outside = await call('GET', runsPath(P_TEAM, SID_TEAM), ACCOUNT_LIMITED)
    expect(outside.status).toBe(404)
    expect(outside.body).toEqual({ error: 'Not found' })
  })
})

describe('QA run writes keep the mcp:write scope', () => {
  it('refuses a read-scoped account key', async () => {
    const res = await call('POST', runPath(P_MINE, SID_MINE), ACCOUNT_READ)
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_SCOPE' } })
  })

  it('queues a run when the account key has mcp:write and the owner can reach the project', async () => {
    const res = await call('POST', runPath(P_MINE, SID_MINE), ACCOUNT_WRITE)
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ ok: true, data: { queued: true } })
  })

  it('refuses a write-scoped key outside its selected-projects limit', async () => {
    const res = await call('POST', runPath(P_TEAM, SID_TEAM), ACCOUNT_LIMITED)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })
})

describe('CLI key header and console JWT still reach the handlers', () => {
  it('accepts X-Mushi-Api-Key when Authorization is not a Mushi key', async () => {
    const res = await call('GET', runsPath(P_TEAM, SID_TEAM), {
      'X-Mushi-Api-Key': ACCOUNT_READ,
      Authorization: 'Bearer not-a-session',
    })
    expect(res.status).toBe(200)
    expectRuns(res.body, RUN_TEAM)
  })

  it('accepts X-Mushi-Api-Key with no Authorization header', async () => {
    const res = await call('GET', runsPath(P_MINE, SID_MINE), { 'X-Mushi-Api-Key': PROJECT_KEY })
    expect(res.status).toBe(200)
    expectRuns(res.body, RUN_MINE)
  })

  it('accepts a console JWT through the real gate', async () => {
    const res = await call('GET', runsPath(P_TEAM, SID_TEAM), { Authorization: `Bearer ${JWT_OWNER}` })
    expect(res.status).toBe(200)
    expectRuns(res.body, RUN_TEAM)
  })

  it('keeps the JWT user id, so a viewer session cannot start a run', async () => {
    const reads = await call('GET', runsPath(P_MINE, SID_MINE), { Authorization: `Bearer ${JWT_VIEWER}` })
    expect(reads.status).toBe(200)
    expectRuns(reads.body, RUN_MINE)

    const started = await call('POST', runPath(P_MINE, SID_MINE), { Authorization: `Bearer ${JWT_VIEWER}` })
    expect(started.status).toBe(403)
    expect(started.body).toMatchObject({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: expect.stringContaining('Viewers have read-only access'),
      },
    })
  })
})

describe('jwtOrApiKey wiring', () => {
  it('a project key naming another project is forbidden before membership', async () => {
    const res = await call('GET', runsPath(P_TEAM, SID_TEAM), PROJECT_KEY)
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'API key does not belong to this project' },
    })
  })

  it('blanks userId for a project key, so a non-member still reads and runs that project', async () => {
    const reads = await call('GET', runsPath(P_MINE, SID_MINE), PROJECT_KEY)
    expect(reads.status).toBe(200)
    expectRuns(reads.body, RUN_MINE)

    const started = await call('POST', runPath(P_MINE, SID_MINE), PROJECT_KEY)
    expect(started.status).toBe(202)
    expect(started.body).toMatchObject({ ok: true, data: { queued: true } })
  })

  it('keeps the owner id for an account key, so a viewer cannot start a run', async () => {
    const reads = await call('GET', runsPath(P_MINE, SID_MINE), VIEWER_WRITE)
    expect(reads.status).toBe(200)
    expectRuns(reads.body, RUN_MINE)

    const started = await call('POST', runPath(P_MINE, SID_MINE), VIEWER_WRITE)
    expect(started.status).toBe(403)
    expect(started.body).toMatchObject({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: expect.stringContaining('Viewers have read-only access'),
      },
    })
  })
})
