/**
 * The console half of recipe changes (gap #8): the fixed source files a form
 * edits, the stale-base guard, the async confirm (202 + background job), the
 * stuck-job sweep, and the SSE loop behind /recipe/changes/:jobId/stream.
 */
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
let change: typeof import('../../supabase/functions/_shared/recipe-change.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/recipe-changes.ts')
  change = await import('../../supabase/functions/_shared/recipe-change.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const OTHER = '1000000c-0000-4000-8000-000000000000'
const clock = new Date('2026-10-03T12:00:00Z')

type Handler = (c: Record<string, unknown>, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Result { status: number; body: { ok: boolean; data?: Record<string, unknown> & { files?: Array<Record<string, unknown>>; denied?: Array<{ path: string; reason: string }> }; error?: { code: string; jobId?: string } } }

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<Result> {
    const [path, qs] = url.split('?')
    const query = new URLSearchParams(qs ?? '')
    for (const r of this.routes) {
      const m = r.pattern.exec(path)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: (k: string) => query.get(k) ?? undefined, header: () => undefined },
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
      return result as Result
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

const manifestText = '{\n  "version": 1,\n  "gates": { "budgets": { "bundle.web.gzip_kb": 300 } },\n  "change": { "allowPaths": ["mushi.recipe.json", ".env.example"] }\n}\n'
const manifest = JSON.parse(manifestText)

function seed(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG, name: 'A' }],
    projects: [{ id: P1, name: 'glot', owner_id: 'owner', organization_id: ORG }, { id: OTHER, name: 'theirs', owner_id: 'stranger', organization_id: null }],
    organization_members: [{ organization_id: ORG, user_id: 'owner', role: 'owner' }],
    project_members: [],
    app_recipe_snapshots: [{ project_id: P1, is_current: true, manifest }],
    recipe_change_jobs: [],
    ...extra,
  } as never, { autoId: true, uniques: { recipe_change_jobs: ['project_id', 'element', 'status'] } })
}

const FILES: Record<string, { text: string; sha: string }> = {
  'mushi.recipe.json': { text: manifestText, sha: 'sha-manifest' },
  'inventory.yaml': { text: 'version: 2\npages: []\n', sha: 'sha-inv' },
}

function harness(db: FakeDb, files: Record<string, { text: string; sha: string }> = FILES) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const background: Array<Promise<unknown>> = []
  const deps = {
    resolveRepo: vi.fn(async () => ({ ok: true as const, repo: { ref: { owner: 'k', repo: 'glot' }, token: 't', repoUrl: '', defaultBranchHint: 'main' } })),
    getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'head123' })),
    readRepoFile: vi.fn(async (_r: unknown, _sha: string, path: string) => {
      const f = files[path]
      return f ? { kind: 'file' as const, path, text: f.text, sha: f.sha, size: f.text.length } : { kind: 'absent' as const, path }
    }),
    createPr: vi.fn(async () => ({ url: 'https://github.com/k/glot/pull/9', number: 9, branch: 'mushi/recipe-gates-x', commitSha: 'c' })),
    findOpenPr: vi.fn(async () => null),
    now: () => clock,
  }
  routes.registerRecipeChangeRoutes(app as never, {
    getServiceClient: () => db as never, adminOrApiKeyRead: pass, adminOrApiKeyWrite: pass, jwtAuth: pass,
    change: deps,
    execute: { fetch: vi.fn(), now: () => clock },
    runInBackground: (task: Promise<unknown>) => { background.push(task) },
  } as never)
  return { app, deps, background }
}

const CHANGES = `/v1/admin/projects/${P1}/recipe/changes`
const newManifest = manifestText.replace('300', '250')

describe('recipe sources for the console forms', () => {
  it('reads only the fixed files of an element, with their SHA and writability', async () => {
    const { app, deps } = harness(seed())
    const gates = await app.call('GET', `/v1/admin/projects/${P1}/recipe/sources?element=gates`)
    expect(gates.status).toBe(200)
    expect(gates.body.data).toMatchObject({ ok: true, element: 'gates', branch: 'main', headSha: 'head123' })
    expect(gates.body.data!.files).toEqual([{ path: 'mushi.recipe.json', exists: true, content: manifestText, sha: 'sha-manifest', writable: true, reason: null }])

    const env = await app.call('GET', `/v1/admin/projects/${P1}/recipe/sources?element=env`)
    expect(env.body.data!.files!.map((f) => [f.path, f.exists, f.writable])).toEqual([['mushi.recipe.json', true, true], ['.env.example', false, true]])

    // inventory.yaml is not in change.allowPaths: shown, but not writable, with the reason.
    const inv = await app.call('GET', `/v1/admin/projects/${P1}/recipe/sources?element=routes`)
    expect(inv.body.data!.files![0]).toMatchObject({ path: 'inventory.yaml', content: 'version: 2\npages: []\n', writable: false, reason: expect.stringMatching(/allowPaths/) })

    expect((await app.call('GET', `/v1/admin/projects/${P1}/recipe/sources?element=design`)).status).toBe(400)
    expect((await app.call('GET', `/v1/admin/projects/${P1}/recipe/sources?element=../../etc`)).status).toBe(400)
    expect(deps.readRepoFile.mock.calls.map((c) => c[2]).sort()).toEqual(['.env.example', 'inventory.yaml', 'mushi.recipe.json', 'mushi.recipe.json'])
  })

  it('never shows a file holding something shaped like a secret, and 404s another team’s project', async () => {
    // Built at runtime so the repo's own secret scan does not flag the fixture.
    const fakeKey = ['sk', 'live', 'abcdefghijklmnopqrstuvwx1234'].join('_')
    const leaky = { ...FILES, 'mushi.recipe.json': { text: `{"version":1,"k":"${fakeKey}"}`, sha: 's' } }
    const { app } = harness(seed(), leaky)
    const r = await app.call('GET', `/v1/admin/projects/${P1}/recipe/sources?element=gates`)
    expect(r.body.data!.files![0]).toMatchObject({ content: null, writable: false, reason: expect.stringMatching(/secret|key/i) })
    expect((await app.call('GET', `/v1/admin/projects/${OTHER}/recipe/sources?element=gates`)).status).toBe(404)
  })

  it('says why nothing is editable when the repo has no manifest', async () => {
    const db = seed({ app_recipe_snapshots: [] })
    const { app } = harness(db)
    const r = await app.call('GET', `/v1/admin/projects/${P1}/recipe/sources?element=gates`)
    expect(r.body.data).toMatchObject({ ok: false, files: [], reason: expect.stringMatching(/mushi\.recipe\.json/) })
  })
})

describe('the stale-base guard', () => {
  it('refuses an edit whose file moved since the preview, and accepts the SHA it was read at', async () => {
    const { app } = harness(seed())
    const same = await app.call('POST', CHANGES, { body: { element: 'gates', edits: [{ path: 'mushi.recipe.json', content: newManifest, baseSha: 'sha-manifest' }] } })
    expect(same.body.data).toMatchObject({ ok: true, denied: [] })
    expect(same.body.data!.files).toHaveLength(1)

    const moved = await app.call('POST', CHANGES, { body: { element: 'gates', edits: [{ path: 'mushi.recipe.json', content: newManifest, baseSha: 'sha-old' }] } })
    expect(moved.body.data!.denied).toEqual([{ path: 'mushi.recipe.json', reason: expect.stringMatching(/changed on main since the preview/) }])

    const created = await app.call('POST', CHANGES, { body: { element: 'gates', edits: [{ path: 'mushi.recipe.json', content: newManifest, baseSha: null }] } })
    expect(created.body.data!.denied![0].reason).toMatch(/was created/)

    const gone = await app.call('POST', CHANGES, { body: { element: 'env', edits: [{ path: '.env.example', content: 'A=\n', baseSha: 'was-there' }] } })
    expect(gone.body.data!.denied![0].reason).toMatch(/was deleted/)
  })

  it('baseMoved: omitted is unchecked, null means absent', () => {
    expect(change.baseMoved(undefined, 'x')).toBeNull()
    expect(change.baseMoved(null, null)).toBeNull()
    expect(change.baseMoved('a', 'a')).toBeNull()
    expect(change.baseMoved('a', 'b')).toBe('this file changed')
  })
})

describe('the async confirm', () => {
  it('answers 202 with a job id, opens the draft PR in the background, and the job row says so', async () => {
    const db = seed()
    const { app, deps, background } = harness(db)
    const r = await app.call('POST', CHANGES, { body: { element: 'gates', dryRun: false, wait: false, edits: [{ path: 'mushi.recipe.json', content: newManifest, baseSha: 'sha-manifest' }] } })
    expect(r.status).toBe(202)
    expect(r.body.data).toMatchObject({ status: 'queued', prUrl: null })
    const jobId = String(r.body.data!.jobId)
    expect(background).toHaveLength(1)
    await Promise.all(background)
    expect(deps.createPr).toHaveBeenCalledWith(expect.objectContaining({ markReady: false, branch: expect.stringMatching(/^mushi\/recipe-gates-/) }))
    const job = await app.call('GET', `${CHANGES}/${jobId}`)
    expect(job.body.data).toMatchObject({ status: 'pr_opened', pr_url: 'https://github.com/k/glot/pull/9', pr_number: 9 })
  })

  it('a second confirm while one runs gets 409 with the running job id to follow', async () => {
    const running = { id: '5000000a-0000-4000-8000-000000000000', project_id: P1, element: 'gates', status: 'queued', requested_by: 'user:owner', created_at: '2026-10-03T11:58:00Z' }
    const { app, background } = harness(seed({ recipe_change_jobs: [running] }))
    const r = await app.call('POST', CHANGES, { body: { element: 'gates', dryRun: false, wait: false, edits: [{ path: 'mushi.recipe.json', content: newManifest }] } })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatchObject({ code: 'ALREADY_RUNNING', jobId: running.id })
    expect(r.body.data).toEqual({ jobId: running.id })
    expect(background).toHaveLength(0)
  })

  it('a job stuck past the cutoff is closed as failed, so the element can be changed again', async () => {
    const stuck = { id: '5000000b-0000-4000-8000-000000000000', project_id: P1, element: 'gates', status: 'queued', requested_by: 'user:owner', created_at: '2026-10-03T11:00:00Z' }
    const db = seed({ recipe_change_jobs: [stuck] })
    const { app, background } = harness(db)
    const before = await app.call('GET', `${CHANGES}/${stuck.id}`)
    expect(before.body.data).toMatchObject({ status: 'failed', error: change.STUCK_JOB_ERROR })
    const r = await app.call('POST', CHANGES, { body: { element: 'gates', dryRun: false, wait: false, edits: [{ path: 'mushi.recipe.json', content: newManifest }] } })
    expect(r.status).toBe(202)
    await Promise.all(background)
    expect(db.table('recipe_change_jobs').find((j) => j.id === stuck.id)).toMatchObject({ status: 'failed', error: change.STUCK_JOB_ERROR })
  })

  it('the default stays synchronous for MCP', async () => {
    const { app, background } = harness(seed())
    const r = await app.call('POST', CHANGES, { body: { element: 'gates', dryRun: false, edits: [{ path: 'mushi.recipe.json', content: newManifest }] } })
    expect(r.status).toBe(201)
    expect(r.body.data).toMatchObject({ status: 'pr_opened', prUrl: 'https://github.com/k/glot/pull/9' })
    expect(background).toHaveLength(0)
  })
})

describe('streamRecipeChangeJob (the SSE loop)', () => {
  type Row = import('../../supabase/functions/_shared/recipe-change.ts').RecipeJobRow
  const row = (over: Partial<Row>): Row => ({ id: 'j', element: 'gates', status: 'queued', pr_url: null, pr_number: null, branch: null, error: null, created_at: '2026-10-03T11:59:00Z', started_at: null, finished_at: null, ...over })

  function io(rows: Array<Row | null>, opts: { aborted?: () => boolean } = {}) {
    const events: Array<[string, Record<string, unknown>]> = []
    let i = 0
    return {
      events,
      io: {
        load: async () => rows[Math.min(i++, rows.length - 1)],
        emit: async (event: 'status' | 'done' | 'error' | 'heartbeat', payload: Record<string, unknown>) => { events.push([event, payload]) },
        sleep: async () => {},
        aborted: opts.aborted ?? (() => false),
        now: () => clock,
        sanitize: (s: string) => s.replace(/[\r\n]/g, ' '),
      },
    }
  }

  it('emits each status change once, then done when the PR opens', async () => {
    const { events, io: x } = io([row({}), row({}), row({ status: 'running' }), row({ status: 'pr_opened', pr_url: 'https://github.com/k/glot/pull/9', pr_number: 9 })])
    await change.streamRecipeChangeJob(x, { pollMs: 1, heartbeatMs: 1000 })
    const statuses = events.filter(([e]) => e === 'status').map(([, p]) => p.status)
    expect(statuses).toEqual(['queued', 'running', 'pr_opened'])
    expect(events.at(-2)?.[1]).toMatchObject({ prUrl: 'https://github.com/k/glot/pull/9', prNumber: 9 })
    expect(events.at(-1)?.[0]).toBe('done')
  })

  it('sanitizes the error, reads a stuck job as failed, and reports a missing job', async () => {
    const rejected = io([row({ status: 'rejected', error: 'Not writable:\nline two' })])
    await change.streamRecipeChangeJob(rejected.io)
    expect(rejected.events[0][1]).toMatchObject({ status: 'rejected', error: 'Not writable: line two' })

    const stuck = io([row({ status: 'running', created_at: '2026-10-03T10:00:00Z' })])
    await change.streamRecipeChangeJob(stuck.io)
    expect(stuck.events.map(([e, p]) => [e, p.status ?? null])).toEqual([['status', 'failed'], ['done', null]])

    const gone = io([null])
    await change.streamRecipeChangeJob(gone.io)
    expect(gone.events).toEqual([['error', { code: 'NOT_FOUND' }]])
  })

  it('times out with STREAM_TIMEOUT so the client falls back to polling, and stops quietly on abort', async () => {
    const slow = io([row({ status: 'running' })])
    await change.streamRecipeChangeJob(slow.io, { pollMs: 10, heartbeatMs: 20, maxMs: 50 })
    expect(slow.events.filter(([e]) => e === 'heartbeat').length).toBeGreaterThan(0)
    expect(slow.events.at(-1)).toEqual(['error', { code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching' }])

    let n = 0
    const aborted = io([row({ status: 'running' })], { aborted: () => n++ > 1 })
    await change.streamRecipeChangeJob(aborted.io, { pollMs: 10, maxMs: 1000 })
    expect(aborted.events.some(([e]) => e === 'error')).toBe(false)
  })
})
