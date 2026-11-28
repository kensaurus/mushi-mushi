/**
 * FILE: ux-captures.test.ts
 * PURPOSE: UX captures from any driver (ADR 0073): the wire shape, the run a
 *          native upload opens (kind scorecard, with its platform and device),
 *          the page rows and upload names the scorecard's score route reads,
 *          and the route: the key's own app only, never for viewers, the
 *          scoring budget reserved before the run exists.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { capturesPlan, capturesRunRow, capturesViewport, captureShotName, UxCapturesBody } from '../../supabase/functions/_shared/ux-captures.ts'

const P = '1a000000-0000-4000-8000-000000000000'
const OTHER = '1b000000-0000-4000-8000-000000000000'
const NOW = new Date('2026-11-27T10:00:00Z')

const facts = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  path: key.startsWith('/') ? key : `/${key}`,
  label: key,
  title: key,
  headings: [],
  text: 'Welcome',
  controls: ['Get started'],
  settleMs: null,
  axe: null,
  overflowX: false,
  consoleErrors: 0,
  cls: 0,
  viewport: { width: 390, height: 844 },
  ...over,
})

const body = (over: Record<string, unknown> = {}) => ({ platform: 'android', device: 'Pixel 8', source: 'adb', pages: [{ facts: facts('/welcome'), shots: ['early', 'settled'] }, { facts: facts('/sign-up'), shots: ['settled'] }], ...over })

describe('the wire shape and rows', () => {
  it('takes pages in the scorecard capture shape, and refuses anything else', () => {
    expect(UxCapturesBody.safeParse(body()).success).toBe(true)
    expect(UxCapturesBody.safeParse(body({ platform: 'symbian' })).success).toBe(false)
    expect(UxCapturesBody.safeParse(body({ pages: [] })).success).toBe(false)
    expect(UxCapturesBody.safeParse(body({ pages: [{ facts: facts('/x'), shots: ['final'] }] })).success).toBe(false)
    expect(UxCapturesBody.safeParse(body({ scoreVia: 'me' })).success).toBe(false)
    expect(UxCapturesBody.safeParse(body({ pages: Array.from({ length: 61 }, (_, i) => ({ facts: facts(`/p${i}`), shots: ['settled'] })) })).success).toBe(false)
  })

  it('opens a scorecard run that says where its captures came from', () => {
    const b = UxCapturesBody.parse(body({ app: 'Shop' }))
    expect(capturesViewport(b)).toBe('390x844')
    expect(capturesViewport({ ...b, viewport: '10x10' })).toBeNull()
    const row = capturesRunRow(b, { projectId: P, localRunId: '20261127-100000-abcd', userId: 'u1', viewport: '390x844', now: NOW })
    expect(row).toMatchObject({ kind: 'scorecard', status: 'running', start_url: null, platform: 'android', device: 'Pixel 8', capture_source: 'adb', detail: 'Shop · Android · Pixel 8 · viewport 390x844', model: 'server' })
  })

  it('plans one unscored page row and one upload per shot, named as the score route reads them', () => {
    const plan = capturesPlan(UxCapturesBody.parse(body()), { projectId: P, runRowId: 'run1', now: NOW })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.uploads.map((u) => u.name)).toEqual(['welcome/early.png', 'welcome/settled.png', 'sign-up/settled.png'])
    expect(plan.uploads[0]!.path).toBe(`${P}/run1/scorecard/welcome/early.png`)
    expect(plan.surfaces).toHaveLength(2)
    expect(plan.surfaces[0]).toMatchObject({ run_id: 'run1', kind: 'page', status: 'pending', thumbs: { scorecard: ['welcome/early.png', 'welcome/settled.png'] } })
    expect(captureShotName('/Sign up', 'settled')).toBe('sign-up/settled.png')
  })

  it('refuses two screens with one key', () => {
    const plan = capturesPlan(UxCapturesBody.parse(body({ pages: [{ facts: facts('/a'), shots: ['settled'] }, { facts: facts('/a'), shots: ['settled'] }] })), { projectId: P, runRowId: 'r', now: NOW })
    expect(plan).toMatchObject({ ok: false, message: expect.stringContaining('Two pages') })
  })
})

// ── The route ───────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({ db: null as unknown, members: new Set<string>(), role: 'admin' as string | null }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next() }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => undefined }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) => c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) => c.json({ ok: false, error: { code, message } }, status),
  callerCanAccessProject: async (_c: unknown, _db: unknown, _u: string, projectId: string) => ({ allowed: state.members.has(projectId), role: state.role }),
}))

let routes: typeof import('../../supabase/functions/api/routes/ux-captures.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/ux-captures.ts')
})

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown>

function setup(opts: { budgetFull?: boolean; failSign?: boolean } = {}): { db: FakeDb; call: (b: unknown, who?: Record<string, unknown>, headers?: Record<string, string>) => Promise<Res> } {
  const db = makeFakeDb(
    { ux_runs: [], ux_surfaces: [] },
    {
      autoId: true,
      rpc: (fn) => (fn === 'reserve_llm_run_budget' ? [opts.budgetFull ? { ok: false, reservation_id: null, held_elsewhere_usd: 1 } : { ok: true, reservation_id: 'res1', held_elsewhere_usd: 0 }] : fn === 'release_llm_run_reservation' ? 0.18 : null),
    },
  )
  ;(db as unknown as Record<string, unknown>).storage = {
    from: () => ({ createSignedUploadUrl: async (path: string) => (opts.failSign ? { data: null, error: { message: 'storage down' } } : { data: { signedUrl: `https://storage.test/${path}?token=t` }, error: null }) }),
  }
  state.db = db
  let handler: Handler | null = null
  routes.registerUxCaptureRoutes({ post: (_p: string, ...h: Handler[]) => (handler = h[h.length - 1]!) } as never)
  const call = async (b: unknown, who: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'apiKey', projectId: P, ...who }
    const c = { req: { json: async () => b, header: (k: string) => headers[k.toLowerCase()] }, get: (k: string) => vars[k], json: (x: unknown, status = 200) => ({ body: x, status }) }
    return (await handler!(c)) as Res
  }
  return { db, call }
}

beforeEach(() => {
  state.members = new Set([P])
  state.role = 'admin'
})

describe('POST /v1/ux/captures', () => {
  it("opens a run on the key's own app, reserves scoring first, and hands back one upload URL per shot", async () => {
    const { db, call } = setup()
    const r = await call(body())
    expect(r.status).toBe(201)
    expect(r.body.data).toMatchObject({ projectId: P, platform: 'android', reservedUsd: 0.18 })
    expect((r.body.data?.uploads as unknown[]).length).toBe(3)
    expect(db.tables.ux_runs![0]).toMatchObject({ kind: 'scorecard', platform: 'android', device: 'Pixel 8', project_id: P })
    expect(db.tables.ux_surfaces).toHaveLength(2)
    const reserve = db.rpcCalls.find((c) => c.fn === 'reserve_llm_run_budget')!
    expect(reserve.args).toMatchObject({ p_kind: 'scorecard', p_ux_run_id: db.tables.ux_runs![0]!.id })
  })

  it("refuses another app's id with this key, a viewer, and a non-member", async () => {
    const { call } = setup()
    expect((await call(body({ projectId: OTHER }))).status).toBe(403)
    state.role = 'viewer'
    expect((await call(body())).status).toBe(403)
    state.role = 'admin'
    expect((await call(body(), { authMethod: 'jwt', projectId: undefined }, { 'x-mushi-project-id': OTHER })).status).toBe(403)
    expect((await call(body(), { authMethod: 'jwt', projectId: undefined })).status).toBe(400)
  })

  it('ends a run it could not set up and gives its budget back, instead of leaving it running', async () => {
    const { db, call } = setup({ failSign: true })
    const r = await call(body())
    expect(r.status).toBe(502)
    expect(db.tables.ux_runs![0]).toMatchObject({ status: 'failed' })
    expect(db.rpcCalls.some((c) => c.fn === 'release_llm_run_reservation' && c.args.p_ux_run_id === db.tables.ux_runs![0]!.id)).toBe(true)
  })

  it('opens nothing when the AI budget cannot cover the scoring', async () => {
    const { db, call } = setup({ budgetFull: true })
    const r = await call(body())
    expect(r.status).toBe(402)
    expect(db.tables.ux_runs).toHaveLength(0)
  })
})
