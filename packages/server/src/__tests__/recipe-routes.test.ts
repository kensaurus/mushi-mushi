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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
let cssScopes: typeof import('../../supabase/functions/_shared/css-scopes.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  recipe = await import('../../supabase/functions/api/routes/recipe.ts')
  dtcg = await import('../../supabase/functions/_shared/dtcg.ts')
  sets = await import('../../supabase/functions/_shared/design-sets.ts')
  schema = await import('../../supabase/functions/_shared/recipe-schema.ts')
  cssScopes = await import('../../supabase/functions/_shared/css-scopes.ts')
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
  put(path: string, ...h: Handler[]) { this.add('PUT', path, h) }
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
const TOKEN_FILE = 'packages/design-tokens/tokens/directions/soi-signpaint/semantic.tokens.json'
const PRIMITIVE_FILE = 'packages/design-tokens/tokens/directions/soi-signpaint/primitive.tokens.json'
const DIRS = ['soi-signpaint', 'pha-khram', 'nang-lamp']
const TREE = DIRS.flatMap((d) => ['primitive', 'semantic', 'component'].map((n) => `packages/design-tokens/tokens/directions/${d}/${n}.tokens.json`))
  .concat(['packages/design-tokens/tokens/directions/pha-khram/assets/key-art.png', 'packages/design-tokens/tokens/directions/pha-khram/assets/notes.txt'])

function glotSnapshot(projectId: string) {
  const parsed = schema.parseRecipeManifest(readFileSync(resolve(__dirname, 'fixtures/recipe/glot-extended.recipe.json'), 'utf8'))
  if (!parsed.ok) throw new Error('fixture manifest invalid')
  const plan = sets.planTokenSets(parsed.manifest.design!.tokens! as never, TREE, parsed.manifest.design!.directions as never)
  const tree = TREE.map((path) => ({ path, size: 1234 }))
  const css = (parsed.manifest.design!.css ?? [])
    .filter((e) => existsSync(resolve(GLOT, e.path)))
    .map((e) => ({ path: e.path, role: e.role ?? 'export', scopes: cssScopes.parseCssScopes(e.path, glotFile(e.path), (e as { scopes?: string[] }).scopes ?? []).scopes }))
  const stored = {
    version: 1,
    active: 'soi-signpaint',
    css,
    // Mirrors refreshRecipeSnapshot: normalize, then meta and assets for directions.
    sets: plan.sets.map((s) => {
      const texts = s.files.map((f) => glotFile(f.path))
      const n = dtcg.normalizeTokenSet(s.files.map((f, i) => ({ path: f.path, role: f.role, text: texts[i] })))
      return s.kind === 'direction'
        ? { ...s, tokens: n.tokens, issues: n.issues, meta: sets.readDirectionMeta(s.name, texts), assets: sets.collectSetAssets(s, parsed.manifest.design!.assets as never, tree) }
        : { ...s, tokens: n.tokens, issues: n.issues }
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
    adminOrApiKeyRead: pass,
    adminOrApiKeyWrite: pass,
    now: () => NOW,
    loadSnapshot: (async (_db: unknown, pid: string) => (db.table('app_recipe_snapshots').find((r) => r.project_id === pid && r.is_current) ?? null)) as never,
    resolveRepo: vi.fn(async () => ({ ok: true as const, repo })),
    getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'head999' })),
    fetchWorkflowRun: vi.fn(async () => null),
    listActionsNames: vi.fn(async () => ['NEXT_PUBLIC_MUSHI_PROJECT_ID']),
    readRepoFile: vi.fn(async (_r: unknown, _ref: string, path: string) =>
      path === 'mushi.recipe.json'
        ? { kind: 'file' as const, path, text: readFileSync(resolve(__dirname, 'fixtures/recipe/glot-extended.recipe.json'), 'utf8'), sha: 's', size: 1 }
        : existsSync(resolve(GLOT, path)) ? { kind: 'file' as const, path, text: glotFile(path), sha: 's', size: 1 } : { kind: 'absent' as const, path }),
    readRepoBytes: vi.fn(async () => ({ kind: 'file' as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })),
    assetSecret: () => 'test-asset-secret',
    createPr: vi.fn(async () => ({ url: 'https://github.com/kensaurus/glot.it/pull/9', number: 9, branch: 'mushi/recipe-design-x', commitSha: 'c' })),
    refresh: vi.fn(async () => ({ ok: true, state: 'unknown' as const, reason: 'ok', snapshotId: 's', tokensHash: 'h', manifestPresent: true, tokenCount: 87, issues: [] })),
    startDeviance: vi.fn(async () => ({ ok: true as const, runId: 'run-1', startedAt: NOW.toISOString(), commitSha: 'abc1234def', execute: vi.fn(async () => ({ ok: false as const, error: 'not awaited here' })) })),
    runInBackground: vi.fn(),
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
  `/v1/admin/projects/${pid}/design/settings`,
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
    expect(d.sets.map((s: any) => [s.name, s.active])).toEqual([['soi-signpaint', true], ['pha-khram', false], ['nang-lamp', false], ['export', false]])
    expect(d.cssScopes.map((s: any) => s.selector)).toEqual(['html:root[data-direction="soi-signpaint"]', 'html.dark:root[data-direction="soi-signpaint"]'])
    expect(d.shownSet).toBe('soi-signpaint')
    expect(d.tokens.length).toBe(151)
    expect(d.tokens.find((t: any) => t.path === 'font.family.body').display).toBe('Sarabun, sans-serif')
    expect(d.contrast).toHaveLength(7)
    expect(d.contrast.filter((p: any) => p.pass === false).map((p: any) => p.ratio)).toEqual([1.63])
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
    expect(Object.values(d.nameMap)).toContain('color.action.primary')
  })

  it('GET /design/excerpt stays under 4 KB and leads with mapped tokens', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/design/excerpt`)
    const d = res.body.data as any
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(4096)
    expect(d.tokens[0].cssVar ?? d.tokens[0].ts).toBeTruthy()
    expect(d.set).toBe('soi-signpaint')
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

describe('deviance runs', () => {
  it('POST /design/deviance/run answers 202 with a running run and hands the scan to the background', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('POST', `/v1/admin/projects/${P_A}/design/deviance/run`)
    expect(res.status).toBe(202)
    expect((res.body.data as any).run).toMatchObject({ runId: 'run-1', status: 'running', score: null })
    expect(deps.runInBackground).toHaveBeenCalledTimes(1)
  })

  it('a scan still running after 15 minutes reads as error, never as running forever', async () => {
    const stuck = { id: 'run-stuck', project_id: P_A, gate: 'design_drift', status: 'running', started_at: '2026-10-02T11:00:00Z', completed_at: null, summary: { phase: 'scan' }, findings_count: 0, commit_sha: 'abc' }
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)], gate_runs: [stuck] }))
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/design`)
    const d = res.body.data as any
    expect(d.state).toBe('error')
    expect(d.deviance.latest).toMatchObject({ status: 'error', error: expect.stringMatching(/did not finish/) })
    const dev = await app.call('GET', `/v1/admin/projects/${P_A}/design/deviance`)
    expect((dev.body.data as any).running).toBeNull()
  })

  it('a finished scan with warn findings is drift, with the score and the stored findings', async () => {
    const run = { id: 'run-2', project_id: P_A, gate: 'design_drift', status: 'warn', started_at: '2026-10-02T11:30:00Z', completed_at: '2026-10-02T11:31:00Z', summary: { phase: 'scan', score: 21, scannedFiles: 3, scannedLines: 900, matchedFiles: 3, breakdown: [], counts: { off_token_color: 1 } }, findings_count: 1, commit_sha: 'abc' }
    const finding = { id: 'f1', gate_run_id: 'run-2', project_id: P_A, severity: 'warn', rule_id: 'off_token_color', message: 'Colour #E8387F is not in your tokens.', file_path: 'app/page.tsx', line: 4, col: 9, allowlisted: false, suggested_fix: { value: '#E8387F', suggestion: { token: 'color.action.primary', cssVar: '--color-cta', ts: 'colors.cta', value: '#C8372D', distance: 9.1 } } }
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)], gate_runs: [run], gate_findings: [finding] }))
    const d = (await app.call('GET', `/v1/admin/projects/${P_A}/design`)).body.data as any
    expect(d.state).toBe('drift')
    expect(d.deviance.latest.score).toBe(21)
    expect(d.deviance.topFindings[0]).toMatchObject({ rule_id: 'off_token_color', value: '#E8387F', suggestion: { cssVar: '--color-cta' } })
    const ex = (await app.call('GET', `/v1/admin/projects/${P_A}/design/excerpt?files=app/page.tsx`)).body.data as any
    expect(ex.findings).toEqual([{ file: 'app/page.tsx', line: 4, rule: 'off_token_color', value: '#E8387F', use: '--color-cta' }])
    expect(ex.score).toBe(21)
  })

  it('a newer push from an old CLI (ci_scan, no score) never blanks the shown score or findings', async () => {
    const run = { id: 'run-2', project_id: P_A, gate: 'design_drift', status: 'warn', started_at: '2026-10-02T11:30:00Z', completed_at: '2026-10-02T11:31:00Z', summary: { phase: 'scan', score: 21, scannedFiles: 3, scannedLines: 900, matchedFiles: 3, breakdown: [], counts: { off_token_color: 1 } }, findings_count: 1, commit_sha: 'abc' }
    const legacy = { id: 'run-ci', project_id: P_A, gate: 'design_drift', status: 'warn', started_at: '2026-10-02T11:50:00Z', completed_at: '2026-10-02T11:50:00Z', summary: { phase: 'ci_scan', source: 'ci', score: null, scannedFiles: 9, storedFindings: 1 }, findings_count: 1, commit_sha: 'def' }
    const finding = { id: 'f1', gate_run_id: 'run-2', project_id: P_A, severity: 'warn', rule_id: 'off_token_color', message: 'Colour #E8387F is not in your tokens.', file_path: 'app/page.tsx', line: 4, col: 9, allowlisted: false, suggested_fix: { value: '#E8387F', suggestion: null } }
    const legacyFinding = { id: 'f2', gate_run_id: 'run-ci', project_id: P_A, severity: 'warn', rule_id: 'off_token_literal', message: 'x', file_path: 'app/x.tsx', line: 1, col: null, allowlisted: false, suggested_fix: null }
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)], gate_runs: [legacy, run], gate_findings: [finding, legacyFinding] }))
    const d = (await app.call('GET', `/v1/admin/projects/${P_A}/design`)).body.data as { deviance: { latest: { runId: string; score: number } } }
    expect(d.deviance.latest).toMatchObject({ runId: 'run-2', score: 21 })
    const dev = (await app.call('GET', `/v1/admin/projects/${P_A}/design/deviance`)).body.data as { latest: { runId: string }; findings: Array<{ rule_id: string }> }
    expect(dev.latest.runId).toBe('run-2')
    expect(dev.findings.map((f) => f.rule_id)).toEqual(['off_token_color'])
  })

  it('design settings: off by default, owners and admins change them, members cannot', async () => {
    const db = seed({ project_settings: [{ project_id: P_A, autofix_enabled: false }] })
    const { app } = harness(db)
    const got = await app.call('GET', `/v1/admin/projects/${P_A}/design/settings`)
    expect(got.body.data).toEqual({ threshold: 40, failCi: false, autofix: false, autofixEnabled: false, canEdit: true })
    expect((await app.call('GET', `/v1/admin/projects/${P_A}/design/settings`, { vars: { userId: 'member-a' } })).body.data).toMatchObject({ canEdit: false })

    const member = await app.call('PUT', `/v1/admin/projects/${P_A}/design/settings`, { body: { failCi: true }, vars: { userId: 'member-a' } })
    expect(member.status).toBe(403)
    expect((await app.call('PUT', `/v1/admin/projects/${P_A}/design/settings`, { body: { threshold: 101 } })).status).toBe(400)
    expect((await app.call('PUT', `/v1/admin/projects/${P_A}/design/settings`, { body: {} })).status).toBe(400)
    expect((await app.call('PUT', `/v1/admin/projects/${P_A}/design/settings`, { body: { failCi: true, extra: 1 } })).status).toBe(400)

    const put = await app.call('PUT', `/v1/admin/projects/${P_A}/design/settings`, { body: { threshold: 25, failCi: true, autofix: true } })
    expect(put.status).toBe(200)
    expect(put.body.data).toEqual({ threshold: 25, failCi: true, autofix: true, autofixEnabled: false, canEdit: true })
    expect(db.table('project_settings')[0]).toMatchObject({ design_deviance_threshold: 25, design_deviance_fail_ci: true, design_drift_autofix: true })
    // Another organization's project stays invisible.
    expect((await app.call('PUT', `/v1/admin/projects/${P_B}/design/settings`, { body: { failCi: true } })).status).toBe(404)
  })

  it('a CI push scored with the shared engine (phase scan, source ci) is the latest scan', async () => {
    const run = { id: 'run-2', project_id: P_A, gate: 'design_drift', status: 'warn', started_at: '2026-10-02T11:30:00Z', completed_at: '2026-10-02T11:31:00Z', summary: { phase: 'scan', score: 21, scannedFiles: 3, scannedLines: 900 }, findings_count: 1, commit_sha: 'abc' }
    const ci = { id: 'run-ci', project_id: P_A, gate: 'design_drift', status: 'pass', started_at: '2026-10-02T11:50:00Z', completed_at: '2026-10-02T11:50:00Z', summary: { phase: 'scan', source: 'ci', score: 4, scannedFiles: 12, scannedLines: 2400 }, findings_count: 0, commit_sha: 'def' }
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)], gate_runs: [ci, run] }))
    const d = (await app.call('GET', `/v1/admin/projects/${P_A}/design`)).body.data as { deviance: { latest: { runId: string; score: number } } }
    expect(d.deviance.latest).toMatchObject({ runId: 'run-ci', score: 4 })
  })
})

// ── the Directions board ─────────────────────────────────────────────────────

describe('GET /design/directions (glot.it: three directions, Soi Signpaint active)', () => {
  it('renders all three directions side by side with names, contrast, fonts, motion, assets and one active', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('GET', `/v1/admin/projects/${P_A}/design/directions`)
    expect(res.status).toBe(200)
    const d = res.body.data as any
    expect(d.directions.map((x: any) => [x.name, x.displayName, x.nativeName, x.active, x.readOnly])).toEqual([
      ['soi-signpaint', 'Soi Signpaint', 'ป้ายเขียนมือ', true, false],
      ['pha-khram', 'Pha Khram', 'ผ้าคราม', false, true],
      ['nang-lamp', 'Nang Lamp', 'หนังตะลุง', false, true],
    ])
    expect(d.directions[0].note).toMatch(/Soi Signpaint look/)
    expect(d.activeDirection).toBe('soi-signpaint')
    for (const dir of d.directions) {
      expect(dir.contrast).toHaveLength(7)
      expect(dir.fonts.length).toBeGreaterThan(0)
      expect(dir.motion.some((m: any) => m.path.startsWith('motion.duration'))).toBe(true)
      expect(dir.line.some((l: any) => l.path.startsWith('radius.'))).toBe(true)
    }
    expect(d.directions[0].fonts.find((f: any) => f.path === 'font.family.display').families).toEqual(['Chonburi', 'serif'])
    // Only images under directions/<name>/ are listed, each with a signed URL.
    const pha = d.directions.find((x: any) => x.name === 'pha-khram')
    expect(pha.assets).toEqual([{ path: 'packages/design-tokens/tokens/directions/pha-khram/assets/key-art.png', kind: 'illustration', size: 1234, url: expect.stringMatching(/^\/v1\/design-assets\/.+\?path=.+&exp=\d+&sig=[0-9a-f]{64}$/) }])
    expect(d.specimen).toMatchObject({ script: 'thai', word: 'น้ำ' })
    expect(d.fontStylesheets).toContain('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped&display=swap')
    expect(d.fontStylesheets).toContain('https://fonts.googleapis.com/css2?family=Chonburi&display=swap')
    expect(d.fontStylesheets.some((u: string) => /family=(sans-serif|serif|monospace)&/.test(u))).toBe(false)
    expect(d.editable).toEqual({ enabled: true, reason: null })
    // Only the active direction carries a deviance result, and none has run yet.
    expect(d.directions.every((x: any) => x.deviance === null)).toBe(true)
    if (process.env.WRITE_ADMIN_FIXTURE === '1') {
      const out = resolve(__dirname, '../../../../apps/admin/src/components/design/__fixtures__')
      mkdirSync(out, { recursive: true })
      writeFileSync(resolve(out, 'glot-directions.json'), JSON.stringify(d, null, 2) + '\n')
    }
  })

  it('serves a signed asset that the snapshot lists, and refuses tampered, expired or unlisted requests', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const d = (await app.call('GET', `/v1/admin/projects/${P_A}/design/directions`)).body.data as any
    const url: string = d.directions.find((x: any) => x.name === 'pha-khram').assets[0].url
    const ok = (await app.call('GET', url)) as unknown as Response
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toBe('image/png')
    expect(ok.headers.get('Content-Security-Policy')).toContain('sandbox')
    const tampered = url.replace('key-art.png', 'semantic.tokens.json')
    expect(((await app.call('GET', tampered)) as unknown as Response).status).toBe(403)
    const badSig = url.replace(/sig=([0-9a-f])/, (_m, c) => `sig=${c === 'a' ? 'b' : 'a'}`)
    expect(((await app.call('GET', badSig)) as unknown as Response).status).toBe(403)
    const later = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }), { now: () => new Date(NOW.getTime() + 60 * 60 * 1000) })
    expect(((await later.app.call('GET', url)) as unknown as Response).status).toBe(403)
    // A valid signature for a path the snapshot does not list is still refused.
    const { signAssetUrl } = await import('../../supabase/functions/_shared/design-assets.ts')
    const unlisted = await signAssetUrl('test-asset-secret', P_A, 'packages/design-tokens/tokens/directions/pha-khram/assets/secret.png', NOW.getTime())
    expect(((await app.call('GET', unlisted)) as unknown as Response).status).toBe(404)
    expect(deps.readRepoBytes).toHaveBeenCalledTimes(1)
  })

  it('without a signing secret, assets list with url null and the route is closed', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }), { assetSecret: () => null })
    const d = (await app.call('GET', `/v1/admin/projects/${P_A}/design/directions`)).body.data as any
    expect(d.directions.find((x: any) => x.name === 'pha-khram').assets[0].url).toBeNull()
  })

  it('is closed to another organization', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_B)] }))
    expect((await app.call('GET', `/v1/admin/projects/${P_B}/design/directions`)).status).toBe(404)
  })
})

describe('POST /design/changes — directions', () => {
  const url = `/v1/admin/projects/${P_A}/design/changes`

  it('"Set active direction" opens a draft PR that only rewrites mushi.recipe.json token paths', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const dry = await app.call('POST', url, { body: { kind: 'activate', direction: 'pha-khram' } })
    expect(dry.status).toBe(200)
    expect((dry.body.data as any).files.map((f: any) => f.path)).toEqual(['mushi.recipe.json'])
    const diff: string = (dry.body.data as any).files[0].diff
    expect(diff).toMatch(/^\+\s+"path": "packages\/design-tokens\/tokens\/directions\/pha-khram\/primitive.tokens.json",$/m)
    expect(diff).toMatch(/^-\s+"path": "packages\/design-tokens\/tokens\/directions\/soi-signpaint\/primitive.tokens.json",$/m)
    const real = await app.call('POST', url, { body: { kind: 'activate', direction: 'pha-khram', dryRun: false } })
    expect(real.status).toBe(200)
    const arg = (deps.createPr as any).mock.calls[0][0]
    expect(arg.markReady).toBe(false)
    expect(arg.files.map((f: any) => f.path)).toEqual(['mushi.recipe.json'])
    const next = JSON.parse(arg.files[0].contents)
    // design.directions[] follows: pha-khram active with the new source paths, soi inactive, and the result validates.
    expect(next.design.directions.map((d: any) => [d.name, d.status])).toEqual([['soi-signpaint', 'inactive'], ['pha-khram', 'active'], ['nang-lamp', 'inactive']])
    expect(schema.parseRecipeManifest(arg.files[0].contents).ok).toBe(true)
    const tokens = next.design.tokens
    expect(tokens.filter((t: any) => t.role === 'source').map((t: any) => t.path.split('/')[4])).toEqual(['pha-khram', 'pha-khram', 'pha-khram'])
    expect(tokens.filter((t: any) => t.role === 'export')).toHaveLength(1)
    expect(arg.title).toBe('chore(design): make pha-khram the active direction')
  })

  it('never edits an inactive direction in place: token edits to it are refused', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const res = await app.call('POST', url, { body: { kind: 'tokens', edits: [{ path: 'color.palette.signal', value: '#000000', set: 'pha-khram' }], dryRun: false } })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'READ_ONLY_DIRECTION' } })
    const shown = (await app.call('GET', `/v1/admin/projects/${P_A}/design?direction=pha-khram`)).body.data as any
    expect(shown.editable).toMatchObject({ enabled: false, reason: expect.stringMatching(/inactive direction/) })
    expect(deps.createPr).not.toHaveBeenCalled()
  })

  it('refuses activating the active direction or an unknown one', async () => {
    const { app } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    expect((await app.call('POST', url, { body: { kind: 'activate', direction: 'soi-signpaint' } })).status).toBe(400)
    expect((await app.call('POST', url, { body: { kind: 'activate', direction: 'nope' } })).status).toBe(400)
  })

  it('"Duplicate / edit direction" opens a draft PR adding only the new folder, with the edit applied to the copy', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    const body = { kind: 'duplicate', from: 'soi-signpaint', name: 'soi-night', displayName: 'Soi Night', edits: [{ path: 'color.palette.signal', value: '#1A1A1A' }], dryRun: false }
    const res = await app.call('POST', url, { body })
    expect(res.status).toBe(200)
    const arg = (deps.createPr as any).mock.calls[0][0]
    expect(arg.markReady).toBe(false)
    const newFiles = ['primitive', 'semantic', 'component'].map((n) => `packages/design-tokens/tokens/directions/soi-night/${n}.tokens.json`)
    // New files only, plus the manifest declaring the copy as an inactive direction; no existing token file is edited.
    expect(arg.files.map((f: any) => f.path)).toEqual([...newFiles, 'mushi.recipe.json'])
    const manifest = JSON.parse(arg.files[3].contents)
    expect(manifest.design.directions.at(-1)).toEqual({ name: 'soi-night', status: 'inactive', tokens: newFiles, note: 'copied from soi-signpaint' })
    expect(schema.parseRecipeManifest(arg.files[3].contents).ok).toBe(true)
    const primitive = JSON.parse(arg.files[0].contents)
    expect(primitive.$extensions['us.kensaur.mushi'].direction).toEqual({ name: 'Soi Night', duplicatedFrom: 'soi-signpaint' })
    expect(primitive.color.palette.signal.$value.hex).toBe('#1A1A1A')
  })

  it('refuses a name that exists, a bad name, or a copy outside change.allowPaths', async () => {
    const { app, deps } = harness(seed({ app_recipe_snapshots: [glotSnapshot(P_A)] }))
    expect((await app.call('POST', url, { body: { kind: 'duplicate', from: 'soi-signpaint', name: 'pha-khram' } })).status).toBe(409)
    expect((await app.call('POST', url, { body: { kind: 'duplicate', from: 'soi-signpaint', name: '../evil' } })).status).toBe(400)
    const snap = glotSnapshot(P_A)
    snap.manifest = { ...snap.manifest, change: { allowPaths: ['mushi.recipe.json'] } }
    const narrow = harness(seed({ app_recipe_snapshots: [snap] }))
    const res = await narrow.app.call('POST', url, { body: { kind: 'duplicate', from: 'soi-signpaint', name: 'soi-night', dryRun: false } })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'PATH_NOT_WRITABLE' } })
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
