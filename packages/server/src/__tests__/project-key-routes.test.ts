/**
 * Route-level checks for the two key-safety bugs (console group E):
 *
 *  - QA bug 31: POST /v1/admin/projects/:id/keys/rotate revoked EVERY active
 *    key on the project and minted one report:write key. It now needs a
 *    keyId, keeps that key's scopes, and revokes only that row.
 *  - QA bug 30: POST /v1/admin/projects/:id/sync-ci-secrets revoked the live
 *    ci-auto key before writing GitHub. Now a failed GitHub write leaves it
 *    active, and only a successful write of the key secret revokes it.
 *
 * Driven on a fake app with a recording fake DB.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/_shared/product-events.ts', () => ({ emitProductEvent: vi.fn() }))
vi.mock('../../supabase/functions/_shared/idempotency.ts', () => ({
  withIdempotency: (_c: unknown, fn: () => unknown) => fn(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (_c: unknown, e: { message: string }) => ({ body: { ok: false, error: e }, status: 500 }),
  callerCanAccessProject: async () => ({ allowed: true, role: 'owner' }),
}))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  resolveProjectGithubToken: async () => 'gh-token',
  parseGithubRepoUrl: (u: string | null) => {
    const m = u ? /github\.com\/([^/]+)\/([^/]+)/.exec(u) : null
    return m ? { owner: m[1], repo: m[2] } : null
  },
}))
vi.mock('../../supabase/functions/_shared/github-pr.ts', () => ({
  // 'forbidden': every GitHub call is refused, as for a GitHub App without Secrets: write.
  ghFetch: async () => {
    if (gh.mode === 'forbidden') throw new Error('GitHub GET public-key → 403: Resource not accessible by integration')
    gh.secretWrites += 1
    return { key_id: 'k1', key: 'cHVi' }
  },
  ghFetchOptional: async () => null,
}))
vi.mock('https://esm.sh/libsodium-wrappers@0.7.13', () => ({
  default: {
    ready: Promise.resolve(),
    from_base64: () => new Uint8Array(),
    crypto_box_seal: () => new Uint8Array(),
    to_base64: () => 'sealed',
    base64_variants: { ORIGINAL: 1 },
  },
}))
const gh = vi.hoisted(() => ({ mode: 'forbidden' as 'forbidden' | 'ok', secretWrites: 0 }))

// ── recording fake DB ────────────────────────────────────────────────────────
interface Op {
  table: string
  op: 'select' | 'insert' | 'update'
  payload?: Record<string, unknown>
  filters: Array<[string, string, unknown]>
}
let ops: Op[] = []
let selectResults: Record<string, unknown> = {}
let updateRows: unknown[] = [{ id: 'x' }]

function builder(table: string) {
  const op: Op = { table, op: 'select', filters: [] }
  ops.push(op)
  const result = () => {
    if (op.op === 'select') return { data: selectResults[table] ?? null, error: null }
    if (op.op === 'insert') return { data: { id: `new-${table}` }, error: null }
    return { data: updateRows, error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (payload: Record<string, unknown>) => { op.op = 'insert'; op.payload = payload; return b },
    update: (payload: Record<string, unknown>) => { op.op = 'update'; op.payload = payload; return b },
    eq: (k: string, v: unknown) => { op.filters.push(['eq', k, v]); return b },
    neq: (k: string, v: unknown) => { op.filters.push(['neq', k, v]); return b },
    like: (k: string, v: unknown) => { op.filters.push(['like', k, v]); return b },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return b
}
const db = { from: (t: string) => builder(t) }

// ── fake app harness ─────────────────────────────────────────────────────────
type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Ctx {
  req: { param: (k: string) => string | undefined; json: () => Promise<unknown>; header: () => undefined; query: () => undefined; url: string; path: string }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: Record<string, unknown>, status?: number) => { body: Record<string, unknown>; status: number }
}

async function call(register: (app: never) => void, path: string, projectId: string, body: unknown) {
  let handlers: Handler[] | null = null
  const app = {
    post: (p: string, ...h: Handler[]) => { if (p === path) handlers = h },
    get: () => {}, put: () => {}, patch: () => {}, delete: () => {},
  }
  register(app as never)
  if (!handlers) throw new Error(`route ${path} not registered`)
  const hs = handlers as Handler[]
  const c: Ctx = {
    req: { param: (k) => (k === 'id' ? projectId : undefined), json: async () => body, header: () => undefined, query: () => undefined, url: 'https://x/', path },
    get: (k) => (k === 'userId' ? 'user-a' : undefined),
    set: () => {},
    json: (b, status = 200) => ({ body: b, status }),
  }
  let result: unknown
  const run = async (i: number): Promise<void> => {
    if (i === hs.length - 1) { result = await hs[i](c); return }
    await hs[i](c, () => run(i + 1))
  }
  await run(0)
  return result as { body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } }; status: number }
}

type KeysRoutes = typeof import('../../supabase/functions/api/routes/project-keys.ts')
type CiRoutes = typeof import('../../supabase/functions/api/routes/project-ci-secrets.ts')
let keys: KeysRoutes
let ci: CiRoutes

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => 'https://abc.supabase.co' } }
  keys = await import('../../supabase/functions/api/routes/project-keys.ts')
  ci = await import('../../supabase/functions/api/routes/project-ci-secrets.ts')
})

const PID = '11111111-1111-4111-8111-111111111111'
const KEY_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  ops = []
  selectResults = {}
  updateRows = [{ id: 'x' }]
})

describe('POST /keys/rotate (QA bug 31)', () => {
  const rotate = (body: unknown) => call(keys.registerProjectKeysRoutes, '/v1/admin/projects/:id/keys/rotate', PID, body)

  it('refuses without a keyId and touches nothing', async () => {
    const res = await rotate({})
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('KEY_ID_REQUIRED')
    expect(ops.filter((o) => o.op !== 'select')).toEqual([])
  })

  it('mints first with the old scopes, then revokes only the named key', async () => {
    selectResults.project_api_keys = { id: KEY_ID, key_prefix: 'mushi_mcp001', label: 'MCP · Cursor', scopes: ['mcp:read', 'mcp:write'] }
    const res = await rotate({ keyId: KEY_ID })
    expect(res.status).toBe(201)
    const writes = ops.filter((o) => o.table === 'project_api_keys' && o.op !== 'select')
    expect(writes.map((o) => o.op)).toEqual(['insert', 'update'])
    expect(writes[0].payload).toMatchObject({ scopes: ['mcp:read', 'mcp:write'], rotated_from: KEY_ID, is_active: true })
    // The revoke is pinned to this key's id, never the whole project.
    expect(writes[1].filters).toContainEqual(['eq', 'id', KEY_ID])
    expect(res.body.data).toMatchObject({ revoked: 1, revoked_prefix: 'mushi_mcp001', old_key_still_active: false })
  })

  it('a key that is gone or already revoked is a 404, with no new key minted', async () => {
    selectResults.project_api_keys = null
    const res = await rotate({ keyId: KEY_ID })
    expect(res.status).toBe(404)
    expect(ops.some((o) => o.op === 'insert')).toBe(false)
  })
})

describe('DELETE-style revoke reports a no-op (QA bug 260)', () => {
  it('returns 404 when no active row matched', async () => {
    let handlers: Handler[] | null = null
    const app = {
      delete: (p: string, ...h: Handler[]) => { if (p === '/v1/admin/projects/:id/keys/:keyId') handlers = h },
      get: () => {}, put: () => {}, patch: () => {}, post: () => {},
    }
    keys.registerProjectKeysRoutes(app as never)
    updateRows = []
    const c: Ctx = {
      req: { param: (k) => (k === 'id' ? PID : k === 'keyId' ? KEY_ID : undefined), json: async () => ({}), header: () => undefined, query: () => undefined, url: '', path: '' },
      get: (k) => (k === 'userId' ? 'user-a' : undefined),
      set: () => {},
      json: (b, status = 200) => ({ body: b, status }),
    }
    const hs = handlers as unknown as Handler[]
    const res = (await hs[hs.length - 1](c)) as { status: number }
    expect(res.status).toBe(404)
  })
})

describe('POST /sync-ci-secrets (QA bug 30)', () => {
  it('when GitHub refuses the write, the old ci-auto key stays active', async () => {
    gh.mode = 'forbidden'
    selectResults.projects = { id: PID, slug: 'acme' }
    selectResults.project_repos = { repo_url: 'https://github.com/acme/app', github_app_installation_id: 7 }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    const res = await call(ci.registerProjectCiSecretsRoutes, '/v1/admin/projects/:id/sync-ci-secrets', PID, {})
    vi.unstubAllGlobals()
    expect(res.body.error?.code).toBe('GH_SECRETS_FORBIDDEN')
    const keyWrites = ops.filter((o) => o.table === 'project_api_keys' && o.op !== 'select')
    // Only the new key is inserted; no update deactivates the old ci-auto key.
    expect(keyWrites.map((o) => o.op)).toEqual(['insert'])
    expect(res.body.data).toMatchObject({ priorKeysRevoked: [] })
  })

  it('revokes the older ci-auto keys only after GitHub accepted the new key, and never the new one', async () => {
    gh.mode = 'ok'
    gh.secretWrites = 0
    selectResults.projects = { id: PID, slug: 'acme' }
    selectResults.project_repos = { repo_url: 'https://github.com/acme/app', github_app_installation_id: 7 }
    updateRows = [{ key_prefix: 'mushi_old111' }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const res = await call(ci.registerProjectCiSecretsRoutes, '/v1/admin/projects/:id/sync-ci-secrets', PID, {})
    vi.unstubAllGlobals()
    expect(res.body.ok).toBe(true)
    expect(gh.secretWrites).toBeGreaterThan(0)
    const keyWrites = ops.filter((o) => o.table === 'project_api_keys' && o.op !== 'select')
    expect(keyWrites.map((o) => o.op)).toEqual(['insert', 'update'])
    expect(keyWrites[1].filters).toEqual(
      expect.arrayContaining([
        ['like', 'label', 'ci-auto:%'],
        ['neq', 'id', 'new-project_api_keys'],
      ]),
    )
    expect(res.body.data).toMatchObject({ priorKeysRevoked: ['mushi_old111'] })
  })
})
