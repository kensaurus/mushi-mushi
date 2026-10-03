/**
 * The design deviance engine is shared with `mushi recipe check`:
 *   1. every engine file is byte-identical in packages/cli/src/recipe/engine/
 *      and imports only other engine files (no npm:, jsr:, URLs or Deno);
 *   2. on one repo that trips every rule, the CLI's check and the server's
 *      scan produce the same findings (rule, file, line, column, value) and
 *      the same score;
 *   3. pushing the CLI's scan to POST /v1/ingest/recipe stores a scored
 *      `phase: 'scan'` run with the CLI's score, the server's rule ids, the
 *      findings in the shape the console reads, and the design.deviance_score
 *      metric.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

const ENGINE = ['recipe-glob.ts', 'design-color.ts', 'dtcg.ts', 'design-engine-types.ts', 'design-deviance.ts', 'design-rules.ts', 'design-set-plan.ts', 'design-scan.ts']
const SERVER_DIR = resolve(__dirname, '../../supabase/functions/_shared')
const CLI_DIR = resolve(__dirname, '../../../cli/src/recipe/engine')

let scan: typeof import('../../supabase/functions/_shared/design-scan.ts')
let schema: typeof import('../../supabase/functions/_shared/recipe-schema.ts')
let dtcg: typeof import('../../supabase/functions/_shared/dtcg.ts')
let sets: typeof import('../../supabase/functions/_shared/design-sets.ts')
let ingest: typeof import('../../supabase/functions/api/routes/recipe-ingest.ts')
let cli: typeof import('../../../cli/src/recipe/local.ts')
let compose: typeof import('../../supabase/functions/api/routes/recipe-compose.ts')
let actions: typeof import('../../supabase/functions/_shared/design-actions.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  scan = await import('../../supabase/functions/_shared/design-scan.ts')
  schema = await import('../../supabase/functions/_shared/recipe-schema.ts')
  dtcg = await import('../../supabase/functions/_shared/dtcg.ts')
  sets = await import('../../supabase/functions/_shared/design-sets.ts')
  ingest = await import('../../supabase/functions/api/routes/recipe-ingest.ts')
  cli = await import('../../../cli/src/recipe/local.ts')
  compose = await import('../../supabase/functions/api/routes/recipe-compose.ts')
  actions = await import('../../supabase/functions/_shared/design-actions.ts')
})

describe('the engine is one source in two places', () => {
  it.each(ENGINE)('%s is byte-identical in the CLI', (file) => {
    expect(readFileSync(resolve(CLI_DIR, file), 'utf8')).toBe(readFileSync(resolve(SERVER_DIR, file), 'utf8'))
  })

  it.each(ENGINE)('%s imports only other engine files', (file) => {
    const text = readFileSync(resolve(SERVER_DIR, file), 'utf8')
    const specifiers = [...text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    for (const s of specifiers) expect(ENGINE).toContain(s.replace(/^\.\//, ''))
    expect(text).not.toMatch(/\bDeno\./)
  })
})

// ── one repo that trips every rule ───────────────────────────────────────────

const TOKENS = {
  color: {
    $type: 'color',
    cta: { $value: { colorSpace: 'srgb', components: [0.784, 0.216, 0.176], hex: '#C8372D' }, $extensions: { 'us.kensaur.mushi': { cssVar: '--color-cta', ts: 'colors.cta' } } },
    ink: { $value: '#13203A', $extensions: { 'us.kensaur.mushi': { cssVar: '--color-ink' } } },
    paper: { $value: '#F4EDE1' },
    faint: { $value: '#E9E2D6' },
  },
  font: { family: { $type: 'fontFamily', body: { $value: ['IBM Plex Sans', 'sans-serif'] } } },
  space: { $type: 'dimension', '1': { $value: { value: 4, unit: 'px' } }, '2': { $value: { value: 8, unit: 'px' } }, '4': { $value: { value: 16, unit: 'px' } } },
  radius: { $type: 'dimension', control: { $value: { value: 12, unit: 'px' } } },
}

const MANIFEST = {
  version: 1,
  design: {
    tokens: [{ path: 'design/tokens.json', role: 'source', format: 'dtcg-2025.10' }],
    components: { globs: ['src/ui/**'] },
    contrast: [{ fg: 'color.ink', bg: 'color.paper' }, { fg: 'color.faint', bg: 'color.paper', use: 'hint text' }],
    rules: {
      raw_interactive_element: { enabled: true, severity: 'warn', primitives: { button: 'Btn' } },
      off_scale_spacing: { severity: 'warn', allowValues: ['2px'] },
      off_token_color: { allowFiles: ['src/legacy/**'] },
    },
  },
}

const REPO: Record<string, string> = {
  'mushi.recipe.json': JSON.stringify(MANIFEST, null, 2),
  'design/tokens.json': JSON.stringify(TOKENS, null, 2),
  'src/App.tsx': [
    "import { Btn } from './ui/Btn'",
    '// #ff00ff in a comment never counts',
    'export function App() {',
    "  const link = 'https://example.com/docs#abc'",
    "  const note = 'see issue #123 for context'",
    "  return <button style={{ color: '#ff0000', background: '#C8372D', padding: 13, margin: 2, fontFamily: 'Comic Sans MS' }} className=\"p-[13px] rounded-[7px] text-[#123456]\">{link}{note}</button>",
    '}',
  ].join('\n'),
  'src/styles.css': [
    '#add { display: block; }',
    '.card { color: rgb(1 2 3); margin: 5px 8px; border-radius: 3px; font-family: Papyrus, sans-serif; }',
    '/* .old { color: #abcdef; } */',
    '.ok { color: var(--color-cta); padding: 16px; border-radius: 12px; }',
  ].join('\n'),
  'src/ui/Btn.tsx': "export const Btn = () => <button style={{ color: '#13203A' }} />",
  'src/legacy/Old.tsx': "export const Old = () => <div style={{ color: '#00ff00' }} />",
  'src/types.d.ts': "declare const x: '#ff0000'",
  'README.md': 'Colour #ff0000 in prose is not scanned.',
}

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

function writeRepo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'mushi-parity-'))
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true })
    writeFileSync(join(dir, p), text)
  }
  return dir
}

/** The server's scan of the same repo: the snapshot as refreshRecipeSnapshot builds it, then computeDeviance over the selected files. */
function serverScan(files: Record<string, string>) {
  const parsed = schema.parseRecipeManifest(files['mushi.recipe.json'])
  if (!parsed.ok) throw new Error('fixture manifest invalid')
  const tree = Object.entries(files).map(([path, text]) => ({ path, size: Buffer.byteLength(text) }))
  const plan = sets.planTokenSets(parsed.manifest.design!.tokens! as never, tree.map((e) => e.path), [])
  const tokenSets = plan.sets.map((s) => {
    const n = dtcg.normalizeTokenSet(s.files.map((f) => ({ path: f.path, role: f.role, text: files[f.path] })))
    return { ...s, tokens: n.tokens, issues: n.issues }
  })
  const snapshot = { manifest: parsed.manifest, tokens: { version: 1 as const, active: tokenSets[0]?.name ?? null, sets: tokenSets } }
  const pick = scan.selectScanFiles(tree, snapshot.manifest, [...scan.tokenFilePaths(snapshot.tokens), 'mushi.recipe.json'])
  const texts = new Map(pick.files.map((p) => [p, files[p]]))
  return { snapshot, result: scan.computeDeviance(snapshot, texts), pick }
}

const key = (f: { rule_id: string; file_path: string | null; line: number | null; col: number | null; value: string }) => `${f.rule_id}|${f.file_path}|${f.line}|${f.col}|${f.value}`

describe('the CLI check and the server scan agree', () => {
  it('finds the same findings and the same score on a repo that trips every rule', () => {
    const server = serverScan(REPO)
    const local = cli.checkRecipe(writeRepo(REPO))
    expect(local.ok).toBe(true)
    expect(local.design).not.toBeNull()

    // Every rule fires on this fixture, so parity is checked rule by rule.
    expect(new Set(server.result.findings.map((f) => f.rule_id))).toEqual(new Set(['off_token_color', 'off_token_font', 'off_scale_spacing', 'off_scale_radius', 'contrast_below_aa', 'raw_interactive_element']))
    expect(local.findings.map(key)).toEqual(server.result.findings.map(key))
    expect(local.findings.map((f) => f.severity)).toEqual(server.result.findings.map((f) => f.severity))
    expect(local.design?.score).toBe(server.result.score)
    expect(local.design?.score).toEqual(expect.any(Number))
    expect(local.design?.scannedFiles).toBe(server.result.scannedFiles)
    expect(local.design?.scannedLines).toBe(server.result.scannedLines)
    expect(local.design?.matchedFiles).toBe(server.pick.matched)

    // What the rules must not flag, on both sides.
    const values = server.result.findings.map((f) => f.value)
    expect(values).not.toContain('#ff00ff') // comment
    expect(values).not.toContain('#abc') // URL fragment
    expect(values).not.toContain('#123') // issue number in prose
    expect(values).not.toContain('#add') // CSS selector
    expect(values).not.toContain('#00ff00') // file the colour rule skips
    expect(values).not.toContain('2px') // allowed value
    expect(server.result.findings.some((f) => f.file_path === 'src/ui/Btn.tsx' && f.rule_id === 'raw_interactive_element')).toBe(false)
    expect(server.result.findings.some((f) => f.file_path === 'src/types.d.ts' || f.file_path === 'README.md')).toBe(false)
  })

  it('a repo with no tokens is not scored on either side', () => {
    const files = { 'mushi.recipe.json': JSON.stringify({ version: 1 }), 'src/a.ts': "const x = '#ff0000'" }
    const local = cli.checkRecipe(writeRepo(files))
    expect(local.ok).toBe(true)
    expect(local.design).toBeNull()
    expect(local.findings).toEqual([])
  })
})

// ── the push is scored by the server ─────────────────────────────────────────

type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Ctx {
  req: { json: () => Promise<unknown>; param: (k: string) => string | undefined; query: () => undefined; header: () => undefined }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  header: () => void
  json: (body: unknown, status?: number) => { body: unknown; status: number }
}

function ingestApp(db: ReturnType<typeof makeFakeDb>, act = vi.fn(async () => ({ action: 'off' as const }))) {
  const routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  const app = {
    get: (path: string, ...handlers: Handler[]) => routes.push({ method: 'GET', path, handlers }),
    post: (path: string, ...handlers: Handler[]) => routes.push({ method: 'POST', path, handlers }),
  }
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  const now = () => new Date('2026-10-03T12:00:00Z')
  ingest.registerRecipeIngestRoutes(app as never, {
    getServiceClient: () => db as never, apiKeyAuth: pass, jwtAuth: pass, adminOrApiKeyRead: pass, now,
    recordCiDeviance: async (d, projectId, input) => (await import('../../supabase/functions/_shared/design-ci-push.ts')).recordCiDeviance(d, projectId, input, { now, act }),
  })
  return {
    act,
    async push(body: unknown, projectId: string) {
      const r = routes.find((x) => x.method === 'POST' && x.path === '/v1/ingest/recipe')!
      const vars: Record<string, unknown> = { projectId }
      const c: Ctx = {
        req: { json: async () => body, param: () => undefined, query: () => undefined, header: () => undefined },
        get: (k) => vars[k], set: (k, v) => { vars[k] = v }, header: () => {},
        json: (b, status = 200) => ({ body: b, status }),
      }
      let result: unknown
      const go = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        await r.handlers[i](c, () => go(i + 1))
      }
      await go(0)
      return result as { status: number; body: { ok: boolean; data: Record<string, unknown> } }
    },
  }
}

const P = '1000000a-0000-4000-8000-000000000000'

describe('POST /v1/ingest/recipe scores the scan the CLI pushed', () => {
  it('stores a phase scan run with the same score, rule ids and finding shape, and the metric', async () => {
    const local = cli.checkRecipe(writeRepo(REPO))
    const db = makeFakeDb({ projects: [{ id: P, organization_id: null }], app_recipe_snapshots: [], project_settings: [{ project_id: P }], project_repos: [] } as never, { autoId: true })
    const { push } = ingestApp(db)
    const res = await push({ commitSha: 'abcdef1', branch: 'main', files: local.files, deviance: cli.pushPayload(local) }, P)
    expect(res.status).toBe(200)
    const dev = res.body.data.deviance as { status: string; score: number; clientScore: number | null; droppedFindings: number; gate: { enabled: boolean }; action: { action: string } }
    expect(dev).toMatchObject({ score: local.design!.score, clientScore: null, droppedFindings: 0, gate: { enabled: false }, action: { action: 'off' } })

    const run = db.table('gate_runs').find((r) => r.gate === 'design_drift')!
    expect(run).toMatchObject({ status: 'fail', triggered_by: 'ci', commit_sha: 'abcdef1' })
    expect(run.summary).toMatchObject({ phase: 'scan', source: 'ci', score: local.design!.score, set: 'default' })
    const stored = db.table('gate_findings').filter((f) => f.gate_run_id === run.id)
    expect(stored.map((f) => `${f.rule_id}|${f.file_path}|${f.line}|${f.col}|${(f.suggested_fix as { value: string }).value}`).sort())
      .toEqual(local.findings.map(key).sort())
    expect(db.table('metric_series')).toEqual([expect.objectContaining({ metric_name: 'design.deviance_score', value: local.design!.score, dimension: 'default' })])
  })

  it('takes no verdict from the client: severity comes from the rules, disabled rules and unsafe paths are refused', async () => {
    const local = cli.checkRecipe(writeRepo(REPO))
    const payload = cli.pushPayload(local)!
    const tampered = {
      ...payload,
      score: 0,
      findings: [
        ...payload.findings,
        { ruleId: 'off_token_literal', filePath: 'src/x.ts', line: 1, col: 1, value: '#000', message: 'x', suggestion: null },
        { ruleId: 'off_token_color', filePath: '../etc/passwd', line: 1, col: 1, value: '#000', message: 'x', suggestion: null },
        { ruleId: 'off_token_color', filePath: 'src/legacy/Old.tsx', line: 1, col: 1, value: '#00ff00', message: 'x', suggestion: null },
      ],
    }
    const db = makeFakeDb({ projects: [{ id: P, organization_id: null }], app_recipe_snapshots: [], project_settings: [{ project_id: P }], project_repos: [] } as never, { autoId: true })
    const res = await ingestApp(db).push({ commitSha: 'abcdef1', branch: 'main', files: local.files, deviance: tampered }, P)
    const dev = res.body.data.deviance as { score: number; clientScore: number; droppedFindings: number }
    expect(dev.droppedFindings).toBe(3)
    expect(dev.score).toBe(local.design!.score)
    expect(dev.clientScore).toBe(0)
    const run = db.table('gate_runs').find((r) => r.gate === 'design_drift')!
    const severities = new Map(db.table('gate_findings').filter((f) => f.gate_run_id === run.id).map((f) => [f.rule_id, f.severity]))
    expect(severities.get('off_scale_spacing')).toBe('warn') // the manifest's override, not the default info
    expect(severities.get('contrast_below_aa')).toBe('error') // judged on the server from the tokens
  })

  it('fails the CI gate above the project limit, and only a default-branch push may act', async () => {
    const local = cli.checkRecipe(writeRepo(REPO))
    const db = makeFakeDb({
      projects: [{ id: P, organization_id: null }],
      app_recipe_snapshots: [],
      project_settings: [{ project_id: P, design_deviance_threshold: 0, design_deviance_fail_ci: true, design_drift_autofix: true, autofix_enabled: true }],
      project_repos: [{ project_id: P, is_primary: true, default_branch: 'trunk' }],
    } as never, { autoId: true })
    const app = ingestApp(db, vi.fn(async () => ({ action: 'baseline' as const })))
    const pr = await app.push({ commitSha: 'abcdef1', branch: 'feature/x', files: local.files, deviance: cli.pushPayload(local) }, P)
    expect(pr.body.data.deviance).toMatchObject({ gate: { enabled: true, failAbove: 0, exceeded: true }, action: { action: 'not_default_branch' } })
    expect(app.act).not.toHaveBeenCalled()
    // A PR run keeps its findings and the gate, but is never the shown score or the metric.
    const prRun = db.table('gate_runs').find((r) => r.commit_sha === 'abcdef1')!
    expect(prRun.summary).toMatchObject({ phase: 'ci_branch_scan', branch: 'feature/x' })
    expect(compose.isScanRun(prRun as never)).toBe(false)
    expect(db.table('metric_series')).toHaveLength(0)
    const main = await app.push({ commitSha: 'abcdef2', branch: 'trunk', files: local.files, deviance: cli.pushPayload(local) }, P)
    expect(main.body.data.deviance).toMatchObject({ action: { action: 'baseline' } })
    expect(app.act).toHaveBeenCalledTimes(1)
    expect(compose.isScanRun(db.table('gate_runs').find((r) => r.commit_sha === 'abcdef2') as never)).toBe(true)
    expect(db.table('metric_series')).toHaveLength(1)
  })

  it('drift that arrives through a PR is still new when the default branch pushes it, and dispatches', async () => {
    const local = cli.checkRecipe(writeRepo(REPO))
    const baseline = { id: 'run-base', project_id: P, gate: 'design_drift', status: 'pass', summary: { phase: 'scan', score: 0 }, started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z' }
    const db = makeFakeDb({
      projects: [{ id: P, organization_id: null }],
      app_recipe_snapshots: [],
      project_settings: [{ project_id: P, design_deviance_threshold: 0, design_drift_autofix: true, autofix_enabled: true }],
      project_repos: [{ project_id: P, is_primary: true, default_branch: 'main' }],
      gate_runs: [baseline],
      gate_findings: [],
      reports: [],
    } as never, { autoId: true })
    const dispatch = vi.fn(async () => ({ ok: true, dispatchId: 'job-1', status: 'queued' }))
    const realAct = vi.fn((d: never, input: never, settings: never) => actions.actOnDesignDeviance(d, input, settings, { dispatch: dispatch as never, now: () => new Date('2026-10-03T12:00:00Z') }))
    const app = ingestApp(db, realAct as never)
    // The PR run is newer than the baseline; were it a scan, main would find nothing new.
    await app.push({ commitSha: 'abc0001', branch: 'feature/x', files: local.files, deviance: cli.pushPayload(local) }, P)
    const res = await app.push({ commitSha: 'abc0002', branch: 'main', files: local.files, deviance: cli.pushPayload(local) }, P)
    expect(res.body.data.deviance).toMatchObject({ action: { action: 'dispatched', dispatchId: 'job-1' } })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'automatic', projectId: P }))
    expect(db.table('reports')).toHaveLength(1)
  })
})
