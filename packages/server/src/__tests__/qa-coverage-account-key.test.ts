/**
 * FILE: packages/server/src/__tests__/qa-coverage-account-key.test.ts
 * PURPOSE: GET …/qa-stories/:sid/runs accepts an account key for a project
 *          that key can reach. The other QA routes keep their previous gates.
 *
 * list_qa_story_runs / get_qa_story_run call this route. jwtOrApiKey delegates
 * to apiKeyAuth, which refuses org-scoped keys, so an account connection got
 * no runs. This mounts the real adminOrApiKey gate.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { hashApiKey } from '../../supabase/functions/_shared/api-key-mint.ts'

const state = vi.hoisted(() => ({ db: null as FakeDb | null }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({ upsertProjectSdkObservationAsync: () => {} }))
vi.mock('../../supabase/functions/_shared/setup-funnel.ts', () => ({ emitFunnelEvent: async () => {} }))

const OWNER = '3000000a-0000-4000-8000-000000000000'
const PID = '1000000a-0000-4000-8000-000000000000'
const OTHER = '1000000b-0000-4000-8000-000000000000'
const STORY = '2000000a-0000-4000-8000-000000000000'
const RUN = '4000000a-0000-4000-8000-000000000000'
const ACCOUNT_KEY = 'mushi_test_qa_account_key_0001' // gitleaks:allow
const PROJECT_KEY = 'mushi_test_qa_project_key_0001' // gitleaks:allow
const WRITE_ONLY_KEY = 'mushi_test_qa_report_key_0001' // gitleaks:allow

let accountHash = ''
let projectHash = ''
let reportHash = ''
let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: () => undefined },
  }
  accountHash = await hashApiKey(ACCOUNT_KEY)
  projectHash = await hashApiKey(PROJECT_KEY)
  reportHash = await hashApiKey(WRITE_ONLY_KEY)
  const routes = await import('../../supabase/functions/api/routes/qa-coverage.ts')
  app = new Hono()
  routes.registerQaCoverageRoutes(app as never)
})

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}): void {
  state.db = makeFakeDb({
    projects: [{ id: PID, name: 'glot', owner_id: OWNER, organization_id: null }],
    organization_members: [],
    project_members: [],
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
    ],
    ...extra,
  })
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

  it('does not let an account key start a run', async () => {
    seed()
    const res = await app.request(`/v1/admin/projects/${PID}/qa-stories/${STORY}/run`, {
      method: 'POST',
      headers: { 'X-Mushi-Api-Key': ACCOUNT_KEY },
    })
    const body = await res.json() as { error?: { code?: string } }
    expect(res.status).toBe(403)
    expect(body.error?.code).toBe('ORG_KEY_NOT_ALLOWED')
  })

  it('leaves every other QA route on its previous gate', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/qa-coverage.ts'), 'utf8')
    const regs = [...src.matchAll(/app\.(get|post|patch|delete)\(\s*'([^']+)',\s*([^,\n]+)/g)]
    expect(regs.length).toBeGreaterThanOrEqual(9)
    const runs = regs.find((m) => m[2].endsWith('/qa-stories/:sid/runs'))
    expect(runs?.[3]).toContain("adminOrApiKey({ scope: 'mcp:read' })")
    for (const m of regs) {
      if (m[2].endsWith('/qa-stories/:sid/runs')) continue
      expect(m[3], m[2]).not.toContain('adminOrApiKey')
    }
    expect(regs.find((m) => m[2].endsWith('/run'))?.[3]).toContain('jwtOrApiKey')
  })
})
