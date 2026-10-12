/**
 * FILE: mcp-oauth-account-grant.test.ts
 * PURPOSE: One MCP OAuth connection can reach all of the user's projects or a
 *          chosen set (ADR 0026). POST /v1/mcp-oauth/approve mints:
 *            access='project'  — a project key (owner/admin only), as before;
 *            access='account'  — an account key (is_org_scoped) for every
 *                                project the approver can reach;
 *            access='selected' — an account key limited to the chosen
 *                                projects (allowed_project_ids).
 *          The token endpoint reports the minted key's real scopes.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as unknown, audits: [] as Array<{ projectId: string; metadata: unknown }> }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({
  logAudit: async (_db: unknown, projectId: string, _a: unknown, _b: unknown, _c: unknown, _d: unknown, metadata: unknown) => {
    state.audits.push({ projectId, metadata })
  },
}))
vi.mock('../../supabase/functions/api/routes/cli-auth.ts', () => ({
  claimIpRateLimit: async () => null,
  extractClientIp: () => '203.0.113.9',
}))

type Routes = typeof import('../../supabase/functions/api/routes/mcp-oauth.ts')
let routes: Routes

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/mcp-oauth.ts')
})

const USER = 'approver'
const ORG = '5000000a-0000-4000-8000-000000000000'
const ORG_B = '5000000b-0000-4000-8000-000000000000'
const P_OWNED = '1000000a-0000-4000-8000-000000000000'
const P_MEMBER = '1000000b-0000-4000-8000-000000000000'
const P_STRANGER = '1000000c-0000-4000-8000-000000000000'
const TXN = '2000000a-0000-4000-8000-000000000000'
const CLIENT = '3000000a-0000-4000-8000-000000000000'
const VERIFIER = 'test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')

function seed(scope = 'mcp:read mcp:write'): FakeDb {
  return makeFakeDb({
    projects: [
      { id: P_OWNED, name: 'Owned', owner_id: USER, organization_id: null },
      { id: P_MEMBER, name: 'Team app', owner_id: 'someone-else', organization_id: ORG },
      { id: P_STRANGER, name: 'Not mine', owner_id: 'stranger', organization_id: ORG_B },
    ],
    organization_members: [{ organization_id: ORG, user_id: USER, role: 'member' }],
    project_members: [],
    project_api_keys: [],
    mcp_oauth_requests: [
      {
        id: TXN,
        client_id: CLIENT,
        status: 'pending',
        scope,
        redirect_uri: 'http://localhost:4567/callback',
        state: 'st',
        resource: null,
        code_challenge: CHALLENGE,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        user_id: USER,
      },
    ],
  })
}

type Handler = (c: unknown, next?: () => Promise<void>) => unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  async call(method: string, path: string, opts: { json?: unknown; form?: Record<string, string> } = {}) {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: USER, authMethod: 'jwt' }
    const raw = new Request(`https://example.supabase.co/functions/v1/api${path}`, {
      method,
      ...(opts.form
        ? { body: new URLSearchParams(opts.form).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
        : {}),
    })
    const c = {
      req: { url: raw.url, raw, json: async () => opts.json, query: () => undefined, header: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: () => {},
      json: (body: unknown, status = 200) => ({ body, status }),
    }
    const handler = route.handlers[route.handlers.length - 1]
    return (await handler(c)) as { status: number; body: { ok?: boolean; data?: { redirect_to: string }; error?: { code: string }; scope?: string; access_token?: string } }
  }
}

function app(): FakeApp {
  const a = new FakeApp()
  routes.registerMcpOauthRoutes(a as never)
  return a
}

function keys(): Array<Record<string, unknown>> {
  return (state.db as FakeDb).table('project_api_keys')
}

beforeEach(() => {
  state.audits = []
})

describe('POST /v1/mcp-oauth/approve — all my projects', () => {
  it('mints one account key for every project the approver can reach, with agent scopes only', async () => {
    state.db = seed('mcp:read mcp:write')
    const res = await app().call('POST', '/v1/mcp-oauth/approve', { json: { txn: TXN, access: 'account' } })
    expect(res.status).toBe(200)
    expect(new URL(res.body.data!.redirect_to).searchParams.get('code')).toMatch(/^[0-9a-f]{64}$/)

    expect(keys()).toHaveLength(1)
    const key = keys()[0]
    expect(key).toMatchObject({ is_org_scoped: true, owner_user_id: USER, label: 'mcp-oauth-account', allowed_project_ids: null })
    expect(key.project_id).toBeUndefined()
    expect(key.scopes).toEqual(['mcp:read', 'mcp:write'])

    const txn = (state.db as FakeDb).table('mcp_oauth_requests')[0]
    expect(txn).toMatchObject({ status: 'approved', project_id: null, api_key_id: key.id })
    expect(state.audits.map((a) => a.projectId).sort()).toEqual([P_OWNED, P_MEMBER].sort())
  })

  it('refuses when the approver has no project', async () => {
    state.db = seed()
    ;(state.db as FakeDb).tables.projects = []
    ;(state.db as FakeDb).tables.organization_members = []
    const res = await app().call('POST', '/v1/mcp-oauth/approve', { json: { txn: TXN, access: 'account' } })
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('NO_PROJECTS')
    expect(keys()).toHaveLength(0)
  })
})

describe('POST /v1/mcp-oauth/approve — selected projects', () => {
  it('limits the account key to the chosen projects, including one where the approver is only a member', async () => {
    state.db = seed()
    const res = await app().call('POST', '/v1/mcp-oauth/approve', { json: { txn: TXN, access: 'selected', project_ids: [P_MEMBER] } })
    expect(res.status).toBe(200)
    expect(keys()[0]).toMatchObject({ is_org_scoped: true, allowed_project_ids: [P_MEMBER], label: 'mcp-oauth-selected' })
    expect(state.audits.map((a) => a.projectId)).toEqual([P_MEMBER])
  })

  it('refuses a project the approver cannot reach and mints nothing', async () => {
    state.db = seed()
    const res = await app().call('POST', '/v1/mcp-oauth/approve', {
      json: { txn: TXN, access: 'selected', project_ids: [P_OWNED, P_STRANGER] },
    })
    expect(res.status).toBe(404)
    expect(keys()).toHaveLength(0)
    expect((state.db as FakeDb).table('mcp_oauth_requests')[0].status).toBe('pending')
  })
})

describe('POST /v1/mcp-oauth/approve — one project (unchanged)', () => {
  it('a body with only project_id still mints a project key', async () => {
    state.db = seed()
    const res = await app().call('POST', '/v1/mcp-oauth/approve', { json: { txn: TXN, project_id: P_OWNED } })
    expect(res.status).toBe(200)
    expect(keys()[0]).toMatchObject({ project_id: P_OWNED, label: 'mcp-oauth' })
    expect(keys()[0].is_org_scoped).toBeUndefined()
  })

  it('still needs owner/admin for a project key', async () => {
    state.db = seed()
    const res = await app().call('POST', '/v1/mcp-oauth/approve', { json: { txn: TXN, access: 'project', project_id: P_MEMBER } })
    expect(res.status).toBe(403)
    expect(keys()).toHaveLength(0)
  })
})

describe('POST /v1/mcp-oauth/token after an account grant', () => {
  it('returns the account key and reports only the scopes it carries', async () => {
    state.db = seed('mcp:read mcp:write')
    const a = app()
    const approved = await a.call('POST', '/v1/mcp-oauth/approve', { json: { txn: TXN, access: 'account' } })
    const code = new URL(approved.body.data!.redirect_to).searchParams.get('code')!
    const res = await a.call('POST', '/v1/mcp-oauth/token', {
      form: { grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: CLIENT },
    })
    expect(res.status).toBe(200)
    expect(res.body.access_token).toMatch(/^mushi_/)
    expect(res.body.scope).toBe('mcp:read mcp:write')
  })
})

describe('GET /v1/mcp-oauth/request', () => {
  it('says whether the client collected its token, so the consent page can explain a failed hand-back', async () => {
    state.db = seed()
    const a = app()
    const call = async () => {
      const route = a.routes.find((r) => r.method === 'GET' && r.path === '/v1/mcp-oauth/request')!
      const vars: Record<string, unknown> = { userId: USER }
      const c = {
        req: { query: (k: string) => (k === 'txn' ? TXN : undefined), header: () => undefined },
        get: (k: string) => vars[k],
        set: (k: string, v: unknown) => { vars[k] = v },
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      return (await route.handlers[route.handlers.length - 1](c)) as { body: { data: { status: string; token_delivered: boolean } } }
    }
    expect((await call()).body.data).toMatchObject({ status: 'pending', token_delivered: false })
    const row = (state.db as FakeDb).table('mcp_oauth_requests')[0]
    row.status = 'approved'
    expect((await call()).body.data).toMatchObject({ status: 'approved', token_delivered: false })
    row.token_claimed_at = new Date().toISOString()
    expect((await call()).body.data.token_delivered).toBe(true)
  })
})

describe('parseApproveRequest', () => {
  it('defaults to a project grant and validates each mode', () => {
    expect(routes.parseApproveRequest({ txn: TXN, project_id: P_OWNED })).toMatchObject({ ok: true, access: 'project' })
    expect(routes.parseApproveRequest({ txn: TXN, access: 'account' })).toMatchObject({ ok: true, access: 'account' })
    expect(routes.parseApproveRequest({ txn: TXN, access: 'selected', project_ids: [P_OWNED, P_OWNED.toUpperCase()] })).toEqual({
      ok: true,
      txn: TXN,
      access: 'selected',
      projectIds: [P_OWNED],
    })
    for (const bad of [
      { txn: 'nope', access: 'account' },
      { txn: TXN },
      { txn: TXN, access: 'selected', project_ids: [] },
      { txn: TXN, access: 'selected', project_ids: [P_OWNED, 7] },
      { txn: TXN, access: 'selected', project_ids: ['not-a-uuid'] },
      { txn: TXN, access: 'everything' },
    ]) {
      expect(routes.parseApproveRequest(bad).ok, JSON.stringify(bad)).toBe(false)
    }
    const tooMany = Array.from({ length: routes.MAX_SELECTED_PROJECTS + 1 }, (_, i) => `1000000a-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(routes.parseApproveRequest({ txn: TXN, access: 'selected', project_ids: tooMany }).ok).toBe(false)
  })

  it('an account key never carries report:write (account keys cannot ingest)', () => {
    expect(routes.accountKeyScopes(['report:write', 'mcp:read', 'mcp:write'])).toEqual(['mcp:read', 'mcp:write'])
    expect(routes.accountKeyScopes(['report:write'])).toEqual(['mcp:read'])
  })
})
