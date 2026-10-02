/**
 * Plan 019 Phase 3 / Plan 020 Phase 4 under ADR 0017's exception: nothing
 * executes on its own. Covers the connector_actions approval (human-only,
 * hash-bound, single-use, expiring) and recipe changes as draft PRs
 * (allowlist, markReady:false, dedupe, per-repo batches).
 */
import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/routes/project-ci-secrets.ts', () => ({ inferStack: () => 'nextjs', requiredCiVarNames: () => [] }))

let routes: typeof import('../../supabase/functions/api/routes/recipe-changes.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/recipe-changes.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const INST = '3000000a-0000-4000-8000-000000000000'
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const SA = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: rsa })
let clock = new Date('2026-10-02T12:00:00Z')

type Handler = (c: any, next?: () => Promise<void>) => Promise<unknown> | unknown
class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<{ status: number; body: any }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => vars[k], set: (k: string, v: unknown) => { vars[k] = v }, header: () => {},
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      let result: unknown
      const go = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        const short = await r.handlers[i](c, () => go(i + 1))
        if (result === undefined && short !== undefined) result = short
      }
      await go(0)
      return result as { status: number; body: any }
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

const manifest = { version: 1, store: { listingDir: 'fastlane/metadata' }, change: { allowPaths: ['mushi.recipe.json', 'tokens/**', 'fastlane/metadata/**'] } }

function seed(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG, name: 'A' }],
    projects: [{ id: P1, name: 'glot', owner_id: 'owner', organization_id: ORG }, { id: P2, name: 'yen', owner_id: 'owner', organization_id: ORG }],
    organization_members: [{ organization_id: ORG, user_id: 'owner', role: 'owner' }, { organization_id: ORG, user_id: 'member', role: 'member' }],
    project_members: [],
    app_recipe_snapshots: [{ project_id: P1, is_current: true, manifest }, { project_id: P2, is_current: true, manifest }],
    connector_instances: [{ id: INST, organization_id: ORG, kind: 'play_console', config: { package: 'com.glotit.app' }, read_credential_ref: 'vault://r', write_credential_ref: 'vault://w', enabled_capabilities: ['snapshot', 'drift', 'act'] }],
    ...extra,
  } as never, { autoId: true, uniques: { recipe_change_jobs: ['project_id', 'element', 'status'] } })
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function playFetch(calls: string[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`)
    if (url.includes('oauth2')) return json(200, { access_token: 't' })
    if (url.endsWith('/edits') && init?.method === 'POST') return json(200, { id: 'e1' })
    return json(200, {})
  })
}

function harness(db: FakeDb, over: Record<string, unknown> = {}) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const calls: string[] = []
  const change = {
    resolveRepo: vi.fn(async (_db: unknown, pid: string) => pid === P2 && (over as { p2NoToken?: boolean }).p2NoToken
      ? { ok: false as const, repoConnected: true, tokenAvailable: false, reason: 'No GitHub token for this project.' }
      : { ok: true as const, repo: { ref: { owner: 'k', repo: pid === P1 ? 'glot' : 'yen' }, token: 't', repoUrl: '', defaultBranchHint: 'main' } }),
    getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'abc1234' })),
    readRepoFile: vi.fn(async (_r: unknown, _sha: string, path: string) => ({ kind: 'file' as const, path, text: 'old\n', sha: 's', size: 4 })),
    createPr: vi.fn(async () => ({ url: 'https://github.com/k/glot/pull/7', number: 7, branch: 'mushi/recipe-design-x', commitSha: 'c' })),
    findOpenPr: vi.fn(async () => null),
    now: () => clock,
  }
  routes.registerRecipeChangeRoutes(app as never, {
    getServiceClient: () => db as never, adminOrApiKeyRead: pass, adminOrApiKeyWrite: pass, jwtAuth: pass,
    change: { ...change, ...(over.change as object ?? {}) },
    execute: { fetch: playFetch(calls), now: () => clock, resolveCredential: vi.fn(async () => SA) },
  } as never)
  return { app, change, calls }
}

const ACTIONS = `/v1/admin/orgs/${ORG}/connector-actions`
const payload = { package: 'com.glotit.app', track: 'production', userFraction: 0.2, versionCodes: ['412'] }

describe('connector action approval', () => {
  it('requesting runs nothing; only a signed-in owner approves and then runs it, once', async () => {
    clock = new Date('2026-10-02T12:00:00Z')
    const db = seed()
    const { app, calls } = harness(db)
    const req = await app.call('POST', ACTIONS, { body: { connectorId: INST, action: 'set_rollout', payload }, vars: { authMethod: 'apiKey', apiKeyPrefix: 'mushi_ab', isOrgScopedKey: true } })
    expect(req.status).toBe(201)
    expect(calls).toHaveLength(0)
    const id = req.body.data.id

    expect((await app.call('POST', `${ACTIONS}/${id}/approve`, { vars: { authMethod: 'apiKey', isOrgScopedKey: true } })).body.error.code).toBe('HUMAN_REQUIRED')
    expect((await app.call('POST', `${ACTIONS}/${id}/approve`, { vars: { userId: 'member' } })).status).toBe(403)
    expect((await app.call('POST', `${ACTIONS}/${id}/execute`)).body.error.code).toBe('NOT_APPROVED')

    const ok = await app.call('POST', `${ACTIONS}/${id}/approve`)
    expect(ok.status).toBe(200)
    expect(ok.body.data.expiresAt).toBe('2026-10-02T13:00:00.000Z')

    const ran = await app.call('POST', `${ACTIONS}/${id}/execute`)
    expect(ran.status).toBe(200)
    expect(calls.some((c) => c.startsWith('PUT') && c.endsWith('/tracks/production'))).toBe(true)
    expect(db.table('connector_actions')[0]).toMatchObject({ status: 'executed' })
    expect((await app.call('POST', `${ACTIONS}/${id}/execute`)).status).toBe(409)
    expect(db.table('org_audit_events').map((e) => e.action)).toEqual(['connector_action.requested', 'connector_action.approved', 'connector_action.executed'])
  })

  it('an expired approval, a changed payload, or act switched off never runs', async () => {
    clock = new Date('2026-10-02T12:00:00Z')
    const db = seed()
    const { app, calls } = harness(db)
    const make = async () => (await app.call('POST', ACTIONS, { body: { connectorId: INST, action: 'set_rollout', payload } })).body.data.id
    const a = await make()
    await app.call('POST', `${ACTIONS}/${a}/approve`)
    clock = new Date('2026-10-02T13:30:00Z')
    expect((await app.call('POST', `${ACTIONS}/${a}/execute`)).body.error.code).toBe('APPROVAL_EXPIRED')

    clock = new Date('2026-10-02T12:00:00Z')
    const b = await make()
    await app.call('POST', `${ACTIONS}/${b}/approve`)
    db.table('connector_actions').find((r) => r.id === b)!.payload = { ...payload, userFraction: 1 }
    expect((await app.call('POST', `${ACTIONS}/${b}/execute`)).body.error.code).toBe('HASH_MISMATCH')

    const c = await make()
    await app.call('POST', `${ACTIONS}/${c}/approve`)
    db.table('connector_instances')[0].enabled_capabilities = ['snapshot']
    expect((await app.call('POST', `${ACTIONS}/${c}/execute`)).body.error.code).toBe('ACT_DISABLED')
    expect(calls.filter((x) => x.startsWith('PUT'))).toHaveLength(0)
  })

  it('refuses an action the connector does not have', async () => {
    const { app } = harness(seed())
    const r = await app.call('POST', ACTIONS, { body: { connectorId: INST, action: 'delete_app', payload: {} } })
    expect(r.body.error.code).toBe('ACTION_NOT_SUPPORTED')
  })
})

describe('recipe changes as draft PRs', () => {
  const CHANGES = `/v1/admin/projects/${P1}/recipe/changes`

  it('dry runs by default, refuses workflow paths, and opens a draft PR that stays a draft', async () => {
    const db = seed()
    const { app, change } = harness(db)
    const dry = await app.call('POST', CHANGES, { body: { element: 'design', edits: [{ path: 'tokens/a.json', content: 'new\n' }] } })
    expect(dry.body.data).toMatchObject({ dryRun: true, ok: true, denied: [] })
    expect(dry.body.data.files[0].diff).toContain('+new')
    expect(change.createPr).not.toHaveBeenCalled()

    const bad = await app.call('POST', CHANGES, { body: { element: 'design', dryRun: false, edits: [{ path: '.github/workflows/x.yml', content: 'x' }] } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('PATH_NOT_WRITABLE')
    expect(change.createPr).not.toHaveBeenCalled()

    const real = await app.call('POST', CHANGES, { body: { element: 'design', dryRun: false, edits: [{ path: 'tokens/a.json', content: 'new\n' }] } })
    expect(real.status).toBe(201)
    expect(change.createPr).toHaveBeenCalledWith(expect.objectContaining({ markReady: false, branch: expect.stringMatching(/^mushi\/recipe-design-/) }))
  })

  it('store edits stay inside the listing folder, and an open Mushi PR is not duplicated', async () => {
    const db = seed()
    const { app } = harness(db, { change: { findOpenPr: vi.fn(async () => ({ number: 3, url: 'https://github.com/k/glot/pull/3', headRef: 'mushi/recipe-store-a' })) } })
    const outside = await app.call('POST', CHANGES, { body: { element: 'store', dryRun: true, edits: [{ path: 'tokens/a.json', content: 'x' }] } })
    expect(outside.body.data.denied[0].reason).toMatch(/fastlane\/metadata/)
    const dup = await app.call('POST', CHANGES, { body: { element: 'store', dryRun: false, edits: [{ path: 'fastlane/metadata/ja/name.txt', content: 'glot.it\n' }] } })
    expect(dup.body.data).toMatchObject({ status: 'rejected', prUrl: 'https://github.com/k/glot/pull/3' })
  })

  it('a portfolio batch opens one draft per repo; a repo without a token fails alone', async () => {
    const db = seed()
    const { app } = harness(db, { p2NoToken: true })
    const r = await app.call('POST', `/v1/admin/orgs/${ORG}/portfolio/changes`, { body: { element: 'design', dryRun: false, changes: [
      { projectId: P1, edits: [{ path: 'tokens/a.json', content: 'new\n' }] },
      { projectId: P2, edits: [{ path: 'tokens/a.json', content: 'new\n' }] },
    ] } })
    expect(r.body.data.opened).toBe(1)
    expect(r.body.data.results.map((x: { status: string }) => x.status)).toEqual(['pr_opened', 'rejected'])
    const batchIds = new Set(db.table('recipe_change_jobs').map((j) => j.batch_id))
    expect(batchIds.size).toBe(1)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/portfolio/changes`, { body: { element: 'design', dryRun: false, changes: [{ projectId: P1, edits: [{ path: 'tokens/a.json', content: 'x' }] }] }, vars: { userId: 'member' } })).status).toBe(403)
  })
})

/** A table whose every read fails, to prove a route does not turn a failed read into "all clear". */
function failingTable(db: FakeDb, table: string): FakeDb {
  const failed = { data: null, error: { message: 'statement timeout' } }
  const chain: any = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(failed).then(ok) : () => chain) })
  return new Proxy(db, { get: (t, prop, r) => (prop === 'from' ? (name: string) => (name === table ? chain : t.from(name)) : Reflect.get(t, prop, r)) })
}

describe('release calendar', () => {
  it('shows each app and the batch, and answers 500 instead of "nothing waiting" when a read fails', async () => {
    const db = seed({
      deploy_observations: [{ project_id: P1, observed_version: '1.2.0', observed_at: '2026-09-20T00:00:00Z', ok: true }],
      fix_attempts: [{ project_id: P1, merged_at: '2026-09-22T00:00:00Z', files_changed: ['ios/App/Podfile'] }],
      ci_workflow_runs: [],
      connector_snapshots: [],
    })
    const { app } = harness(db)
    const ok = await app.call('GET', `/v1/admin/orgs/${ORG}/releases`)
    expect(ok.status).toBe(200)
    expect(ok.body.data.rows.find((r: { projectId: string }) => r.projectId === P1)).toMatchObject({ mergedNotBuilt: 1, builtNotSubmitted: null })
    const { app: broken } = harness(failingTable(db, 'fix_attempts'))
    const r = await broken.call('GET', `/v1/admin/orgs/${ORG}/releases`)
    expect(r.status).toBe(500)
    expect(r.body.error.code).toBe('DB_ERROR')
  })
})
