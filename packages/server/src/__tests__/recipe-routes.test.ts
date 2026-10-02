/**
 * `api/routes/recipe.ts` — the App Recipe and design-plane routes, driven on a
 * fake Hono app with a fake DB and injected GitHub deps (no network).
 *
 * Covers: cross-organization access denial on every route (and a
 * project-bound API key aimed at another project), "never checked is never
 * ok" on an empty project, the glot.it fixture ingested and rendered by
 * GET /design, the draft-PR change path (dry run, allowlist refusals,
 * markReady:false, admin-only PRs) and the refresh rate limit.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/routes/project-ci-secrets.ts', () => ({
  inferStack: () => 'nextjs',
  requiredCiVarNames: () => [{ name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID', ghKind: 'variable' }, { name: 'NEXT_PUBLIC_MUSHI_API_KEY', ghKind: 'secret' }],
}))

type RecipeModule = typeof import('../../supabase/functions/api/routes/recipe.ts')
let recipe: RecipeModule
let dtcg: typeof import('../../supabase/functions/_shared/dtcg.ts')
let sets: typeof import('../../supabase/functions/_shared/design-sets.ts')
let schema: typeof import('../../supabase/functions/_shared/recipe-schema.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  recipe = await import('../../supabase/functions/api/routes/recipe.ts')
  dtcg = await import('../../supabase/functions/_shared/dtcg.ts')
  sets = await import('../../supabase/functions/_shared/design-sets.ts')
  schema = await import('../../supabase/functions/_shared/recipe-schema.ts')
})

// ── fake Hono surface ────────────────────────────────────────────────────────

type Handler = (c: FakeContext, next?: () => Promise<void>) => Promise<unknown> | unknown
interface JsonResult { body: Record<string, unknown>; status: number }
interface FakeContext {
  req: { json: () => Promise<unknown>; header: (k: string) => string | undefined; param: (k: string) => string | undefined; query: (k: string) => string | undefined }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: Record<string, unknown>, status?: number) => JsonResult
}

class FakeApp {
  routes = new Map<string, { pattern: RegExp; keys: string[]; handlers: Handler[] }>()
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`)
    this.routes.set(`${method} ${path}`, { pattern, keys, handlers })
  }
  get(path: string, ...h: Handler[]) { this.add('GET', path, h) }
  post(path: string, ...h: Handler[]) { this.add('POST', path, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<JsonResult> {
    const [path, qs] = url.split('?')
    for (const [key, r] of this.routes) {
      if (!key.startsWith(`${method} `)) continue
      const m = r.pattern.exec(path)
      if (!m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
      const query = new URLSearchParams(qs ?? '')
      const vars: Record<string, unknown> = { userId: 'user-a', authMethod: 'jwt', requestId: 'req-1', ...opts.vars }
      const c: FakeContext = {
        req: { json: async () => opts.body, header: () => undefined, param: (k) => params[k], query: (k) => query.get(k) ?? undefined },
        get: (k) => vars[k],
        set: (k, v) => { vars[k] = v },
        json: (body, status = 200) => ({ body, status }),
      }
      let result: unknown
      const run = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        const short = await r.handlers[i](c, () => run(i + 1))
        if (result === undefined && short !== undefined) result = short
      }
      await run(0)
      return result as JsonResult
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = '0000000a-0000-4000-8000-000000000000'
const ORG_B = '0000000b-0000-4000-8000-000000000000'
const P_A = '1000000a-0000-4000-8000-000000000000'
const P_B = '1000000b-0000-4000-8000-000000000000'
const GLOT = resolve(__dirname, 'fixtures/recipe/glot')
const glotFile = (p: string) => readFileSync(resolve(GLOT, p), 'utf8')
const NOW = new Date('2026-10-02T12:00:00Z')
const TOKEN_FILE = 'packages/design-tokens/tokens/directions/pha-khram/semantic.tokens.json'
const PRIMITIVE_FILE = 'packages/design-tokens/tokens/directions/pha-khram/primitive.tokens.json'

function glotSnapshot(projectId: string) {
  const parsed = schema.parseRecipeManifest(glotFile('mushi.recipe.json'))
  if (!parsed.ok) throw new Error('fixture manifest invalid')
  const plan = sets.planTokenSets(parsed.manifest.design!.tokens! as never, [
    'packages/design-tokens/tokens/directions/nang-lamp/primitive.tokens.json',
    'packages/design-tokens/tokens/directions/nang-lamp/semantic.tokens.json',
    'packages/design-tokens/tokens/directions/nang-lamp/component.tokens.json',
  ])
  const stored = {
    version: 1,
    active: 'pha-khram',
    sets: plan.sets.map((s) => {
      const n = dtcg.normalizeTokenSet(s.files.map((f) => ({ path: f.path, role: f.role, text: glotFile(f.path) })))
      return { ...s, tokens: n.tokens, issues: n.issues }
    }),
  }
  return {
    id: 'snap-1', project_id: projectId, organization_id: ORG_A, commit_sha: 'abc1234def', source: 'repo_file',
    manifest: parsed.manifest, tokens: stored, tokens_hash: 'f'.repeat(64),
    components: [{ name: 'Button', file: 'design-system/primitives/Button.tsx' }],
    validation_errors: [], is_current: true, captured_at: '2026-10-02T11:00:00Z',
  }
}

function seed(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    projects: [
      { id: P_A, owner_id: 'owner-a', organization_id: ORG_A, slug: 'glot-it' },
      { id: P_B, owner_id: 'owner-b', organization_id: ORG_B, slug: 'other' },
    ],
    organization_members: [
      { organization_id: ORG_A, user_id: 'user-a', role: 'admin' },
      { organization_id: ORG_A, user_id: 'member-a', role: 'member' },
    ],
    project_members: [],
    ...extra,
  } as never)
}

function harness(db: FakeDb, over: Partial<RecipeModule['defaultRecipeDeps']> = {}) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const repo = { ref: { owner: 'kensaurus', repo: 'glot.it' }, token: 't', repoUrl: 'https://github.com/kensaurus/glot.it', defaultBranchHint: 'main' }
  const deps = {
    ...recipe.defaultRecipeDeps,
    getServiceClient: () => db as never,
    readAuth: pass,
    writeAuth: pass,
    now: () => NOW,
    loadSnapshot: (async (_db: unknown, pid: string) => (db.table('app_recipe_snapshots').find((r) => r.project_id === pid && r.is_current) ?? null)) as never,
    resolveRepo: vi.fn(async () => ({ ok: true as const, repo })),
    getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'head999' })),
    fetchWorkflowRun: vi.fn(async () => null),
    listActionsNames: vi.fn(async () => ['NEXT_PUBLIC_MUSHI_PROJECT_ID']),
    readRepoFile: vi.fn(async (_r: unknown, _ref: string, path: string) => ({ kind: 'file' as const, path, text: glotFile(path), sha: 's', size: 1 })),
    createPr: vi.fn(async () => ({ url: 'https://github.com/kensaurus/glot.it/pull/9', number: 9, branch: 'mushi/recipe-design-x', commitSha: 'c' })),
    refresh: vi.fn(async () => ({ ok: true, state: 'unknown' as const, reason: 'ok', snapshotId: 's', tokensHash: 'h', manifestPresent: true, tokenCount: 87, issues: [] })),
    runDeviance: vi.fn(async () => ({ ok: false as const, error: 'not in this test' })),
    ...over,
  }
  recipe.registerRecipeRoutes(app as never, deps as never)
  return { app, deps }
}

const READ_ROUTES = (pid: string) => [
  `/v1/admin/projects/${pid}/recipe`,
  `/v1/admin/projects/${pid}/recipe/elements/design`,
  `/v1/admin/projects/${pid}/recipe/history`,
  `/v1/admin/projects/${pid}/design`,
  `/v1/admin/projects/${pid}/design/tokens`,
  `/v1/admin/projects/${pid}/design/deviance`,
  `/v1/admin/projects/${pid}/design/excerpt`,
]
const WRITE_ROUTES = (pid: string) => [
  `/v1/admin/projects/${pid}/recipe/refresh`,
  `/v1/admin/projects/${pid}/design/deviance/run`,
  `/v1/admin/projects/${pid}/design/changes`,
]

// ── access ───────────────────────────────────────────────────────────────────

describe('cross-organization access', () => {
  it('a member of org A gets 404 on every read and write route of an org B project, and nothing runs', async () => {
    const db = seed({ app_recipe_snapshots: [glotSnapshot(P_B)] })
    const { app, deps } = harness(db)
    for (const url of READ_ROUTES(P_B)) {
      const res = await app.call('GET', url)
      expect(res.status, url).toBe(404)
      expect(res.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    }
    for (const url of WRITE_ROUTES(P_B)) {
      const res = await app.call('POST', url, { body: { kind: 'tokens', edits: [{ path: 'color.action.primary', value: '#000000' }], dryRun: false } })
      expect(res.status, url).toBe(404)
    }
    expect(deps.refresh).not.toHaveBeenCalled()
    expect(deps.createPr).not.toHaveBeenCalled()
    expect(deps.resolveRepo).not.toHaveBeenCalled()
  })

  it('a project-bound API key cannot read another project, even one its owner owns', async () => {
    const db = seed()
    const { app } = harness(db)
    const res = await app.call('GET', `/v1/admin/projects/${P_B}/recipe`, { vars: { userId: 'owner-b', authMethod: 'apiKey', projectId: P_A } })
    expect(res.status).toBe(404)
  })

  it('a malformed project id is 404, not a DB error', async () => {
    const { app } = harness(seed())
    expect((await app.call('GET', '/v1/admin/projects/not-a-uuid/recipe')).status).toBe(404)
  })
})

// ── the recipe ───────────────────────────────────────────────────────────────

describe('GET /recipe', () => {
  it('an empty project renders no element as ok', async () => {
    const { app } = harness(seed(), { resolveRepo: vi.fn(async () => ({ ok: false as const, repoConnected: false, tokenAvailable: false, reason: 'No primary GitHub repo is connected to this project.' })) })
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/recipe`)
    expect(res.status).toBe(200)
    const data = res.body.data as { elements: Record<string, { state: string; reason: string }>; worst: string }
    expect(Object.keys(data.elements)).toEqual(['schema', 'design', 'routes', 'gates', 'ci', 'deploy', 'env', 'integrations'])
    for (const [key, el] of Object.entries(data.elements)) {
      expect(el.state, key).not.toBe('ok')
      expect(['ok', 'drift', 'unknown', 'not_connected', 'error']).toContain(el.state)
      expect(el.reason.length, key).toBeGreaterThan(0)
    }
    expect(data.elements.schema.state).toBe('not_connected')
    expect(data.elements.design.state).toBe('not_connected')
  })

  it('a repo whose CI read fails shows ci as error, never ok', async () => {
    const { app } = harness(seed(), { getDefaultHead: vi.fn(async () => { throw new Error('403 from GitHub') }) })
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/recipe`)
    const data = res.body.data as { elements: Record<string, { state: string; reason: string }> }
    expect(data.elements.ci).toMatchObject({ state: 'error', reason: expect.stringMatching(/403/) })
    expect(data.elements.env.state).toBe('drift')
  })

  it('rejects an unknown element name', async () => {
    const { app } = harness(seed())
    expect((await app.call('GET', `/v1/admin/projects/${P_A}/recipe/elements/kitchen-sink`)).status).toBe(400)
  })
})

// ── the design plane on the glot.it fixture ─────────────────────────────────

describe('GET /design (glot.it Pha Khram fixture)', () => {
  it('renders the ingested tokens, directions, contrast and components; deviance never scored is unknown', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/design`)
    expect(res.status).toBe(200)
    const d = res.body.data as Record<string, any>
    expect(d.state).toBe('unknown')
    expect(d.reason).toMatch(/never run/)
    expect(d.sets.map((s: any) => [s.name, s.active])).toEqual([['pha-khram', true], ['nang-lamp', false], ['export', false]])
    expect(d.shownSet).toBe('pha-khram')
    expect(d.tokens.length).toBe(87)
    expect(d.tokens.find((t: any) => t.path === 'font.family.body').display).toContain('Thai')
    expect(d.contrast).toHaveLength(8)
    expect(d.contrast.every((p: any) => p.pass === true)).toBe(true)
    expect(d.components).toEqual([{ name: 'Button', file: 'design-system/primitives/Button.tsx' }])
    expect(d.editable).toMatchObject({ enabled: true, manifestWritable: true })
    expect(d.editable.tokenFiles).toContain(TOKEN_FILE)
    expect(d.deviance.latest).toBeNull()
  })

  it('shows a sibling direction on request and the export set as read-only', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const other = await app.call('GET', `/v1/admin/projects/${P_A}/design?direction=nang-lamp`)
    expect((other.body.data as any).shownSet).toBe('nang-lamp')
    const exp = await app.call('GET', `/v1/admin/projects/${P_A}/design?direction=export`)
    expect((exp.body.data as any).editable).toMatchObject({ enabled: false, reason: expect.stringMatching(/generated export/) })
  })

  it('GET /design/tokens filters by group and returns the name map agents use', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/design/tokens?group=color&type=color`)
    const d = res.body.data as any
    expect(d.tokens.every((t: any) => t.group === 'color')).toBe(true)
    expect(d.nameMap['--color-cta']).toBe('color.action.primary')
    expect(d.nameMap['colors.cta']).toBe('color.action.primary')
  })

  it('GET /design/excerpt stays under 4 KB and leads with mapped tokens', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/design/excerpt`)
    const d = res.body.data as any
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(4096)
    expect(d.tokens[0].cssVar ?? d.tokens[0].ts).toBeTruthy()
    expect(d.set).toBe('pha-khram')
  })
})

// ── changes: always a draft PR, only to allowlisted token/recipe files ──────

describe('POST /design/changes', () => {
  const url = `/v1/admin/projects/${P_A}/design/changes`

  it('a dry run returns the diff and never opens a PR', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('POST', url, { body: { kind: 'tokens', edits: [{ path: 'color.palette.signal', value: '#B23A2E' }] } })
    expect(res.status).toBe(200)
    const d = res.body.data as any
    expect(d.dryRun).toBe(true)
    expect(d.files.map((f: any) => f.path)).toEqual([PRIMITIVE_FILE])
    expect(d.files[0].diff).toContain('#B23A2E')
    expect(d.pr).toBeNull()
    expect(deps.createPr).not.toHaveBeenCalled()
  })

  it('confirming opens one DRAFT PR (markReady:false) touching only the token file', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('POST', url, { body: { kind: 'tokens', edits: [{ path: 'color.palette.signal', value: '#B23A2E' }], dryRun: false } })
    expect(res.status).toBe(200)
    expect((res.body.data as any).pr).toMatchObject({ number: 9, draft: true })
    expect(deps.createPr).toHaveBeenCalledTimes(1)
    const arg = (deps.createPr as any).mock.calls[0][0]
    expect(arg.markReady).toBe(false)
    expect(arg.files.map((f: any) => f.path)).toEqual([PRIMITIVE_FILE])
    expect(arg.branch).toMatch(/^mushi\/recipe-design-/)
  })

  it('refuses tokens from the generated export: listed as denied in a dry run, 400 PATH_NOT_WRITABLE on confirm', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const edit = { path: 'primitive.color.bg', value: '#000000', set: 'export' }
    const dry = await app.call('POST', url, { body: { kind: 'tokens', edits: [edit] } })
    expect((dry.body.data as any).denied).toEqual([{ path: 'packages/design-tokens/dtcg/tokens.json', reason: expect.stringMatching(/generated export/) }])
    const real = await app.call('POST', url, { body: { kind: 'tokens', edits: [edit], dryRun: false } })
    expect(real.status).toBe(400)
    expect(real.body).toMatchObject({ error: { code: 'PATH_NOT_WRITABLE' } })
    expect(deps.createPr).not.toHaveBeenCalled()
  })

  it('refuses a token file outside change.allowPaths', async () => {
    const snap = glotSnapshot(P_A)
    snap.manifest = { ...snap.manifest, change: { allowPaths: ['mushi.recipe.json'] } }
    const { app, deps } = harness(seed({ app_recipe_snapshots: [snap] }))
    const res = await app.call('POST', url, { body: { kind: 'tokens', edits: [{ path: 'color.palette.signal', value: '#B23A2E' }], dryRun: false } })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'PATH_NOT_WRITABLE' } })
    expect(deps.createPr).not.toHaveBeenCalled()
  })

  it('a rules change writes only mushi.recipe.json', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('POST', url, { body: { kind: 'rules', rules: { off_scale_radius: { severity: 'warn' } }, dryRun: false } })
    expect(res.status).toBe(200)
    const arg = (deps.createPr as any).mock.calls[0][0]
    expect(arg.files.map((f: any) => f.path)).toEqual(['mushi.recipe.json'])
    expect(JSON.parse(arg.files[0].contents).design.rules.off_scale_radius).toEqual({ severity: 'warn' })
    expect(arg.markReady).toBe(false)
  })

  it('a member may preview but not open a PR; a malformed body is 400', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const body = { kind: 'tokens', edits: [{ path: 'color.palette.signal', value: '#B23A2E' }] }
    expect((await app.call('POST', url, { body, vars: { userId: 'member-a' } })).status).toBe(200)
    expect((await app.call('POST', url, { body: { ...body, dryRun: false }, vars: { userId: 'member-a' } })).status).toBe(403)
    expect((await app.call('POST', url, { body: { kind: 'nope' } })).status).toBe(400)
    expect(deps.createPr).not.toHaveBeenCalled()
  })
})

describe('POST /recipe/refresh', () => {
  it('is limited to one refresh per 5 minutes', async () => {
    const snap = { ...glotSnapshot(P_A), captured_at: '2026-10-02T11:58:00Z' }
    const { app, deps } = harness(seed({ app_recipe_snapshots: [snap] }))
    const res = await app.call('POST', `/v1/admin/projects/${P_A}/recipe/refresh`)
    expect(res.status).toBe(429)
    expect(deps.refresh).not.toHaveBeenCalled()
  })
  it('refreshes when the snapshot is older', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('POST', `/v1/admin/projects/${P_A}/recipe/refresh`)
    expect(res.status).toBe(200)
    expect(deps.refresh).toHaveBeenCalledTimes(1)
  })
})
