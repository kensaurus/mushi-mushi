/**
 * FILE: packages/server/src/__tests__/qa-coverage-account-key.test.ts
 * PURPOSE: Account keys can read a story's runs and queue a manual run
 *          (MCP list_qa_story_runs / run_qa_story) for a project the key
 *          owner can reach. GET /qa-coverage stays on the SDK ingest gate,
 *          which refuses every org-scoped key.
 *
 * jwtOrApiKey delegates to apiKeyAuth, which answers ORG_KEY_NOT_ALLOWED
 * before it looks at scopes. The runs read and the manual run mount
 * adminOrApiKey instead. A project key stays pinned to its own project.
 * Other QA routes are checked by calling them.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { hashApiKey } from '../../supabase/functions/_shared/api-key-mint.ts'

const state = vi.hoisted(() => ({ db: null as FakeDb | null }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({ upsertProjectSdkObservationAsync: () => {} }))
vi.mock('../../supabase/functions/_shared/setup-funnel.ts', () => ({ emitFunnelEvent: async () => {} }))

const OWNER = '3000000a-0000-4000-8000-000000000000'
const MEMBER = '3000000b-0000-4000-8000-000000000000'
const ORG = '6000000a-0000-4000-8000-000000000000'
const PID = '1000000a-0000-4000-8000-000000000000'
const OTHER = '1000000b-0000-4000-8000-000000000000'
const STORY = '2000000a-0000-4000-8000-000000000000'
const RUN = '4000000a-0000-4000-8000-000000000000'
const ACCOUNT_KEY = 'mushi_test_qa_account_key_0001' // gitleaks:allow
const ACCOUNT_WRITE_KEY = 'mushi_test_qa_account_write_001' // gitleaks:allow
const PROJECT_KEY = 'mushi_test_qa_project_key_0001' // gitleaks:allow
const WRITE_ONLY_KEY = 'mushi_test_qa_report_key_0001' // gitleaks:allow
const PROJECT_WRITE_KEY = 'mushi_test_qa_mcp_write_key_001' // gitleaks:allow

let accountHash = ''
let accountWriteHash = ''
let projectHash = ''
let reportHash = ''
let projectWriteHash = ''
let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: () => undefined },
  }
  accountHash = await hashApiKey(ACCOUNT_KEY)
  accountWriteHash = await hashApiKey(ACCOUNT_WRITE_KEY)
  projectHash = await hashApiKey(PROJECT_KEY)
  reportHash = await hashApiKey(WRITE_ONLY_KEY)
  projectWriteHash = await hashApiKey(PROJECT_WRITE_KEY)
  const routes = await import('../../supabase/functions/api/routes/qa-coverage.ts')
  app = new Hono()
  routes.registerQaCoverageRoutes(app as never)
})

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}): void {
  state.db = makeFakeDb({
    projects: [{ id: PID, name: 'glot', owner_id: OWNER, organization_id: null }],
    organization_members: [],
    project_members: [],
    qa_stories: [{
      id: STORY,
      project_id: PID,
      browser_provider: 'firecrawl_actions',
      script: null,
      prompt: 'open home',
      enabled: true,
    }],
    qa_story_runs: [{
      id: RUN,
      story_id: STORY,
      project_id: PID,
      status: 'failed',
      started_at: '2026-10-26T00:00:00Z',
      error_message: 'button missing',
    }],
    project_api_keys: [
      {
        id: '5000000a-0000-4000-8000-000000000000',
        key_hash: accountHash,
        key_prefix: 'mushi_test',
        project_id: null,
        is_org_scoped: true,
        allowed_project_ids: null,
        is_active: true,
        scopes: ['mcp:read'],
        owner_user_id: OWNER,
        last_seen_origin: null,
        browser_seen_at: null,
        projects: null,
      },
      {
        id: '5000000e-0000-4000-8000-000000000000',
        key_hash: accountWriteHash,
        key_prefix: 'mushi_test',
        project_id: null,
        is_org_scoped: true,
        allowed_project_ids: null,
        is_active: true,
        scopes: ['mcp:write'],
        owner_user_id: OWNER,
        last_seen_origin: null,
        browser_seen_at: null,
        projects: null,
      },
      {
        id: '5000000b-0000-4000-8000-000000000000',
        key_hash: projectHash,
        key_prefix: 'mushi_test',
        project_id: PID,
        is_org_scoped: false,
        allowed_project_ids: null,
        is_active: true,
        scopes: ['mcp:read'],
        owner_user_id: OWNER,
        last_seen_origin: null,
        browser_seen_at: null,
        projects: { name: 'glot' },
      },
      {
        id: '5000000c-0000-4000-8000-000000000000',
        key_hash: reportHash,
        key_prefix: 'mushi_test',
        project_id: null,
        is_org_scoped: true,
        allowed_project_ids: null,
        is_active: true,
        scopes: ['report:write'],
        owner_user_id: OWNER,
        last_seen_origin: null,
        browser_seen_at: null,
        projects: null,
      },
      {
        id: '5000000d-0000-4000-8000-000000000000',
        key_hash: projectWriteHash,
        key_prefix: 'mushi_test',
        project_id: PID,
        is_org_scoped: false,
        allowed_project_ids: null,
        is_active: true,
        scopes: ['mcp:write'],
        owner_user_id: OWNER,
        last_seen_origin: null,
        browser_seen_at: null,
        projects: { name: 'glot' },
      },
    ],
    ...extra,
  }, { autoId: true })
}

function runsUrl(projectId: string): string {
  return `/v1/admin/projects/${projectId}/qa-stories/${STORY}/runs`
}

async function getRuns(projectId: string, key: string) {
  seed()
  const res = await app.request(runsUrl(projectId), { headers: { 'X-Mushi-Api-Key': key } })
  const body = await res.json() as { ok?: boolean; data?: { runs?: Array<{ id: string }> }; error?: { code?: string; message?: string } | string }
  return { status: res.status, body }
}

function runUrl(projectId: string): string {
  return `/v1/admin/projects/${projectId}/qa-stories/${STORY}/run`
}

async function postRun(projectId: string, key: string) {
  const res = await app.request(runUrl(projectId), {
    method: 'POST',
    headers: { 'X-Mushi-Api-Key': key },
  })
  const body = await res.json() as {
    ok?: boolean
    data?: { run_id?: string; queued?: boolean }
    error?: { code?: string; message?: string } | string
  }
  return { status: res.status, body }
}

describe('GET qa story runs with an account key', () => {
  it('returns runs for a project the key owner can reach', async () => {
    const { status, body } = await getRuns(PID, ACCOUNT_KEY)
    expect(status).toBe(200)
    expect(body.data?.runs?.map((r) => r.id)).toEqual([RUN])
  })

  it('hides a project the owner cannot reach', async () => {
    const { status, body } = await getRuns(OTHER, ACCOUNT_KEY)
    expect(status).toBe(404)
    expect(body.error).toBe('Not found')
  })

  it('honours a selected-projects limit', async () => {
    seed()
    const keys = state.db!.table('project_api_keys')
    const account = keys.find((k) => k.key_hash === accountHash)
    account!.allowed_project_ids = [OTHER]
    const res = await app.request(runsUrl(PID), { headers: { 'X-Mushi-Api-Key': ACCOUNT_KEY } })
    expect(res.status).toBe(404)
  })

  it('keeps a project key on its own project and refuses another', async () => {
    const own = await getRuns(PID, PROJECT_KEY)
    expect(own.status).toBe(200)
    const other = await getRuns(OTHER, PROJECT_KEY)
    expect(other.status).toBe(403)
    expect(other.body.error).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('still requires mcp:read', async () => {
    const { status, body } = await getRuns(PID, WRITE_ONLY_KEY)
    expect(status).toBe(403)
    expect(body.error).toMatchObject({ code: 'INSUFFICIENT_SCOPE' })
  })

  it('lets a project key with only mcp:write read runs', async () => {
    // jwtOrApiKey already required mcp:read on GET, and mcp:write implies it
    // (keyGrantsAnyScope). adminOrApiKey({ scope: 'mcp:read' }) uses that same
    // rule, so a project key that never listed mcp:read still reads runs.
    const { status, body } = await getRuns(PID, PROJECT_WRITE_KEY)
    expect(status).toBe(200)
    expect(body.data?.runs?.map((r) => r.id)).toEqual([RUN])
  })

  it('does not let a read-only account key start a run', async () => {
    seed()
    const { status, body } = await postRun(PID, ACCOUNT_KEY)
    expect(status).toBe(403)
    expect(body.error).toMatchObject({ code: 'INSUFFICIENT_SCOPE' })
  })

  it('leaves every other QA route on its previous gate', async () => {
    // Ask each route with the account key. jwtAuth has no Bearer and answers
    // 401. jwtOrApiKey sees the key and refuses an account key. adminOrApiKey
    // would let this key through, so a gate swap fails here without parsing
    // the route file.
    seed()
    const jwtOnly = [
      ['GET', `/v1/admin/projects/${PID}/qa-coverage/stats`],
      ['GET', `/v1/admin/projects/${PID}/qa-coverage-summary`],
      ['GET', `/v1/admin/projects/${PID}/qa-stories/${STORY}`],
      ['POST', `/v1/admin/projects/${PID}/qa-stories`],
      ['PATCH', `/v1/admin/projects/${PID}/qa-stories/${STORY}`],
      ['DELETE', `/v1/admin/projects/${PID}/qa-stories/${STORY}`],
      ['GET', `/v1/admin/projects/${PID}/qa-stories/${STORY}/runs/${RUN}/evidence`],
      ['GET', `/v1/admin/projects/${PID}/platform-rollup`],
    ] as const
    for (const [method, url] of jwtOnly) {
      const res = await app.request(url, { method, headers: { 'X-Mushi-Api-Key': ACCOUNT_KEY } })
      const body = await res.json() as { error?: { code?: string } }
      expect(res.status, url).toBe(401)
      expect(body.error?.code, url).toBe('MISSING_AUTH')
    }

    // The coverage list shares nothing with the manual-run gate. An account
    // key that can queue a run is still refused here.
    for (const key of [ACCOUNT_KEY, ACCOUNT_WRITE_KEY]) {
      const res = await app.request(`/v1/admin/projects/${PID}/qa-coverage`, {
        headers: { 'X-Mushi-Api-Key': key },
      })
      const body = await res.json() as { error?: { code?: string } }
      expect(res.status, key).toBe(403)
      expect(body.error?.code, key).toBe('ORG_KEY_NOT_ALLOWED')
    }

    const coverage = await app.request(`/v1/admin/projects/${PID}/qa-coverage`, {
      headers: { 'X-Mushi-Api-Key': PROJECT_KEY },
    })
    expect(coverage.status).toBe(200)
  })
})

describe('POST qa story run with an account key', () => {
  it('queues a run for an account key with mcp:write', async () => {
    seed()
    const { status, body } = await postRun(PID, ACCOUNT_WRITE_KEY)
    expect(status).toBe(202)
    expect(body.data?.queued).toBe(true)
    expect(body.data?.run_id).toEqual(expect.any(String))
    const queued = state.db!.table('qa_story_runs').find((r) => r.id === body.data?.run_id)
    expect(queued).toMatchObject({ story_id: STORY, project_id: PID, status: 'pending', triggered_by: 'manual' })
  })

  it('queues a run for a project key with mcp:write and refuses another project', async () => {
    seed()
    const own = await postRun(PID, PROJECT_WRITE_KEY)
    expect(own.status).toBe(202)
    seed()
    const other = await postRun(OTHER, PROJECT_WRITE_KEY)
    expect(other.status).toBe(403)
    expect(other.body.error).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('hides a project the account key owner cannot reach', async () => {
    seed()
    const { status, body } = await postRun(OTHER, ACCOUNT_WRITE_KEY)
    expect(status).toBe(404)
    expect(body.error).toBe('Not found')
  })

  it('honours a selected-projects limit', async () => {
    seed()
    const account = state.db!.table('project_api_keys').find((k) => k.key_hash === accountWriteHash)
    account!.allowed_project_ids = [OTHER]
    const { status, body } = await postRun(PID, ACCOUNT_WRITE_KEY)
    expect(status).toBe(404)
    expect(body.error).toBe('Not found')
  })

  it('refuses a viewer account key', async () => {
    seed({
      project_members: [{ project_id: PID, user_id: MEMBER, role: 'viewer' }],
    })
    const account = state.db!.table('project_api_keys').find((k) => k.key_hash === accountWriteHash)
    account!.owner_user_id = MEMBER
    const { status, body } = await postRun(PID, ACCOUNT_WRITE_KEY)
    expect(status).toBe(403)
    expect(body.error).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('lets an org member who does not own the app queue a run', async () => {
    seed({
      projects: [{ id: PID, name: 'glot', owner_id: OWNER, organization_id: ORG }],
      organization_members: [{ organization_id: ORG, user_id: MEMBER, role: 'member' }],
    })
    const account = state.db!.table('project_api_keys').find((k) => k.key_hash === accountWriteHash)
    account!.owner_user_id = MEMBER
    const { status, body } = await postRun(PID, ACCOUNT_WRITE_KEY)
    expect(status).toBe(202)
    expect(body.data?.queued).toBe(true)
  })

  it('refuses a disabled story', async () => {
    seed()
    state.db!.table('qa_stories')[0]!.enabled = false
    const { status, body } = await postRun(PID, ACCOUNT_WRITE_KEY)
    expect(status).toBe(409)
    expect(body.error).toBe('Story is disabled')
  })

  it('still refuses a report:write account key', async () => {
    seed()
    const { status, body } = await postRun(PID, WRITE_ONLY_KEY)
    expect(status).toBe(403)
    expect(body.error).toMatchObject({ code: 'INSUFFICIENT_SCOPE' })
  })

  it('lets the project owner run from the console and refuses a viewer', async () => {
    seed()
    allowConsoleUser(OWNER)
    const owner = await app.request(runUrl(PID), { method: 'POST', headers: { Authorization: `Bearer ${OWNER}` } })
    expect(owner.status).toBe(202)

    seed({ project_members: [{ project_id: PID, user_id: MEMBER, role: 'viewer' }] })
    allowConsoleUser(MEMBER)
    const viewer = await app.request(runUrl(PID), { method: 'POST', headers: { Authorization: `Bearer ${MEMBER}` } })
    const body = await viewer.json() as { error?: { code?: string } }
    expect(viewer.status).toBe(403)
    expect(body.error?.code).toBe('FORBIDDEN')
  })
})

/** Console JWT: getClaims returns this user. The token is the user id. */
function allowConsoleUser(userId: string): void {
  Object.assign(state.db!, {
    auth: {
      getClaims: async (token: string) =>
        token === userId
          ? { data: { claims: { sub: userId, role: 'authenticated', email: 'member@example.test' } }, error: null }
          : { data: null, error: { message: 'invalid' } },
    },
  })
}

async function getRunsAsUser(userId: string) {
  allowConsoleUser(userId)
  const res = await app.request(runsUrl(PID), { headers: { Authorization: `Bearer ${userId}` } })
  const body = await res.json() as { ok?: boolean; data?: { runs?: Array<{ id: string }> }; error?: { code?: string } | string }
  return { status: res.status, body }
}

describe('GET qa story runs with a console session', () => {
  it('lets an org member who does not own the project read runs', async () => {
    seed({
      projects: [{ id: PID, name: 'glot', owner_id: OWNER, organization_id: ORG }],
      organization_members: [{ organization_id: ORG, user_id: MEMBER, role: 'member' }],
      project_members: [],
    })
    const { status, body } = await getRunsAsUser(MEMBER)
    expect(status).toBe(200)
    expect(body.data?.runs?.map((r) => r.id)).toEqual([RUN])
  })

  it('lets a project viewer who does not own the project read runs', async () => {
    seed({
      project_members: [{ project_id: PID, user_id: MEMBER, role: 'viewer' }],
    })
    const { status, body } = await getRunsAsUser(MEMBER)
    expect(status).toBe(200)
    expect(body.data?.runs?.map((r) => r.id)).toEqual([RUN])
  })

  it('hides a project the signed-in user cannot reach', async () => {
    seed()
    const { status, body } = await getRunsAsUser(MEMBER)
    expect(status).toBe(404)
    expect(body.error).toBe('Not found')
  })
})
