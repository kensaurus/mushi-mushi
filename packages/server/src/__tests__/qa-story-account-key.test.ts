/**
 * POST /v1/admin/projects/:pid/qa-stories/:sid/run is an admin action.
 * An account (org-scoped) key with mcp:write must be able to start a run on
 * an app the key can reach. SDK ingest (apiKeyAuth) still rejects that key.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as FakeDb | null }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

const ORG = '5000000a-0000-4000-8000-000000000000'
const P_MINE = '1000000a-0000-4000-8000-000000000000'
const P_TEAM = '1000000b-0000-4000-8000-000000000000'
const P_FOREIGN = '1000000c-0000-4000-8000-000000000000'
const STORY = '2000000a-0000-4000-8000-000000000000'
const STORY_OFF = '2000000b-0000-4000-8000-000000000000'
const STORY_FOREIGN = '2000000c-0000-4000-8000-000000000000'
const OWNER = 'key-owner'
const VIEWER = 'key-viewer'

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

const ACCOUNT = 'mushi_accountkey0123456789abcdef'
const READONLY = 'mushi_readonlykey0123456789abcdef'
const LIMITED = 'mushi_limitedkey0123456789abcdef'
const VIEWER_KEY = 'mushi_viewerkey0123456789abcdef0'
const PROJECT_KEY = 'mushi_projectkey0123456789abcdef'
const SDK_KEY = 'mushi_sdkkey0123456789abcdefghijkl'

function key(raw: string, over: Record<string, unknown>) {
  return {
    id: raw.slice(6, 18),
    key_hash: hash(raw),
    key_prefix: raw.slice(0, 12),
    project_id: null,
    is_org_scoped: true,
    allowed_project_ids: null,
    is_active: true,
    scopes: ['mcp:write'],
    owner_user_id: OWNER,
    last_seen_origin: null,
    browser_seen_at: null,
    projects: null,
    ...over,
  }
}

function seed(): FakeDb {
  return makeFakeDb(
    {
      projects: [
        { id: P_MINE, name: 'Mine', owner_id: OWNER, organization_id: ORG, created_at: '2026-01-01' },
        { id: P_TEAM, name: 'Team', owner_id: 'someone-else', organization_id: ORG, created_at: '2026-01-02' },
        { id: P_FOREIGN, name: 'Foreign', owner_id: 'stranger', organization_id: null, created_at: '2026-01-03' },
      ],
      organization_members: [
        { organization_id: ORG, user_id: OWNER, role: 'admin' },
        { organization_id: ORG, user_id: VIEWER, role: 'viewer' },
      ],
      project_members: [],
      project_api_keys: [
        key(ACCOUNT, {}),
        key(READONLY, { scopes: ['mcp:read'] }),
        key(LIMITED, { allowed_project_ids: [P_MINE] }),
        key(VIEWER_KEY, { owner_user_id: VIEWER }),
        key(PROJECT_KEY, { is_org_scoped: false, project_id: P_TEAM, projects: { name: 'Team' } }),
        key(SDK_KEY, { is_org_scoped: false, project_id: P_TEAM, scopes: ['report:write'], projects: { name: 'Team' } }),
      ],
      qa_stories: [
        { id: STORY, project_id: P_TEAM, browser_provider: 'firecrawl_actions', enabled: true },
        { id: STORY_OFF, project_id: P_TEAM, browser_provider: 'firecrawl_actions', enabled: false },
        { id: STORY_FOREIGN, project_id: P_FOREIGN, browser_provider: 'local', enabled: true },
      ],
      qa_story_runs: [],
    },
    { autoId: true },
  )
}

let app: Hono
let ingest: Hono
let apiKeyAuth: (c: never, next: () => Promise<void>) => Promise<unknown>

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (k: string) => undefined } } }).Deno = { env: { get: () => undefined } }
  const routes = await import('../../supabase/functions/api/routes/qa-coverage.ts')
  const auth = await import('../../supabase/functions/_shared/auth.ts')
  apiKeyAuth = auth.apiKeyAuth as typeof apiKeyAuth
  app = new Hono()
  routes.registerQaCoverageRoutes(app as never)
  ingest = new Hono()
  ingest.post('/v1/reports', apiKeyAuth as never, (c) => c.json({ ok: true }))
})

beforeEach(() => {
  state.db = seed()
})

function runs(): Array<Record<string, unknown>> {
  return state.db!.table('qa_story_runs')
}

async function post(pid: string, sid: string, raw: string) {
  const res = await app.request(`/v1/admin/projects/${pid}/qa-stories/${sid}/run`, {
    method: 'POST',
    headers: { 'X-Mushi-Api-Key': raw },
  })
  const body = (await res.json()) as { ok?: boolean; data?: { run_id?: string }; error?: { code?: string; message?: string } }
  return { status: res.status, body }
}

describe('POST /qa-stories/:sid/run with an account key', () => {
  it('starts a run on a team app the key owner can reach', async () => {
    const res = await post(P_TEAM, STORY, ACCOUNT)
    expect(res.status).toBe(202)
    expect(res.body.data?.run_id).toBeTruthy()
    expect(runs()).toEqual([
      expect.objectContaining({
        id: res.body.data?.run_id,
        story_id: STORY,
        project_id: P_TEAM,
        status: 'pending',
        triggered_by: 'manual',
        provider: 'firecrawl_actions',
      }),
    ])
  })

  it('does not start a run on a project the account cannot reach', async () => {
    const res = await post(P_FOREIGN, STORY_FOREIGN, ACCOUNT)
    expect(res.status).toBe(404)
    expect(runs()).toEqual([])
  })

  it('does not start a run outside a limited account key', async () => {
    const res = await post(P_TEAM, STORY, LIMITED)
    expect(res.status).toBe(404)
    expect(runs()).toEqual([])
  })

  it('refuses a viewer account key', async () => {
    const res = await post(P_TEAM, STORY, VIEWER_KEY)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('FORBIDDEN')
    expect(runs()).toEqual([])
  })

  it('refuses a public SDK key (report:write only)', async () => {
    const res = await post(P_TEAM, STORY, SDK_KEY)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('INSUFFICIENT_SCOPE')
    expect(runs()).toEqual([])
  })

  it('refuses an account key that can only read', async () => {
    const res = await post(P_TEAM, STORY, READONLY)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('INSUFFICIENT_SCOPE')
    expect(runs()).toEqual([])
  })

  it('still refuses a disabled story', async () => {
    const res = await post(P_TEAM, STORY_OFF, ACCOUNT)
    expect(res.status).toBe(409)
    expect(runs()).toEqual([])
  })

  it('keeps a project-bound key on its own project', async () => {
    const ok = await post(P_TEAM, STORY, PROJECT_KEY)
    expect(ok.status).toBe(202)
    const wrong = await post(P_MINE, STORY, PROJECT_KEY)
    expect(wrong.status).toBe(403)
    expect(wrong.body.error?.message).toContain('does not belong to this project')
    expect(runs()).toHaveLength(1)
  })
})

describe('SDK ingest still rejects an account key', () => {
  it('answers 403 ORG_KEY_NOT_ALLOWED and still accepts a project key', async () => {
    const org = await ingest.request('/v1/reports', { method: 'POST', headers: { 'X-Mushi-Api-Key': ACCOUNT } })
    expect(org.status).toBe(403)
    expect(((await org.json()) as { error: { code: string } }).error.code).toBe('ORG_KEY_NOT_ALLOWED')

    const project = await ingest.request('/v1/reports', { method: 'POST', headers: { 'X-Mushi-Api-Key': PROJECT_KEY } })
    expect(project.status).toBe(200)
  })
})
